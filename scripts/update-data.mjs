#!/usr/bin/env node
// Downloads movies and TV series from TMDB and anime from AniList into Data/,
// where the /api/recommend route picks them up alongside the IMDb CSVs.
//
//   TMDB_API_KEY=<key> npm run update-data
//   npm run update-data -- --only=anime            (AniList needs no key)
//   npm run update-data -- --from-year=2024 --movie-pages=10
//
// TMDB_API_KEY accepts either the v3 "API Key" or the v4 "API Read Access Token"
// from https://www.themoviedb.org/settings/api.
//
// Options:
//   --only=movies,series,anime   which catalogs to refresh (default: all three)
//   --from-year / --to-year      movie release years to fetch (default: 1920 to this year)
//   --movie-pages=N              pages of 20 movies per year, most-voted first (default 5)
//   --series-pages=N             pages of 20 most-voted series (default 50)
//   --anime-pages=N              pages of 50 most popular anime (default 60)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'Data');

// Overridable so the script can be pointed at a local mock server in tests
const TMDB_BASE_URL = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const ANILIST_URL = process.env.ANILIST_URL || 'https://graphql.anilist.co';
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p/w342';

const TMDB_CONCURRENCY = 8;
// AniList allows 90 requests a minute (30 while degraded); stay under the lower limit
const ANILIST_DELAY_MS = 2100;

const THIS_YEAR = new Date().getFullYear();

function parseArgs(argv) {
    const args = Object.fromEntries(
        argv
            .filter(a => a.startsWith('--'))
            .map(a => {
                const [key, value = 'true'] = a.slice(2).split('=');
                return [key, value];
            }),
    );
    const int = (key, fallback) => {
        const n = parseInt(args[key] ?? '', 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    return {
        only: new Set((args.only || 'movies,series,anime').split(',').map(s => s.trim())),
        fromYear: int('from-year', 1920),
        toYear: int('to-year', THIS_YEAR),
        moviePages: int('movie-pages', 5),
        seriesPages: int('series-pages', 50),
        animePages: int('anime-pages', 60),
    };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retries rate limits and transient server errors, honouring Retry-After
async function fetchJson(url, init = {}, attempt = 1) {
    let response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        if (attempt >= 5) throw error;
        await sleep(1000 * 2 ** attempt);
        return fetchJson(url, init, attempt + 1);
    }
    if (response.status === 429 || response.status >= 500) {
        if (attempt >= 5) throw new Error(`${response.status} from ${url}`);
        const retryAfter = parseInt(response.headers.get('retry-after') || '', 10);
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * 2 ** attempt);
        return fetchJson(url, init, attempt + 1);
    }
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} from ${url}: ${(await response.text()).slice(0, 200)}`);
    }
    return response.json();
}

// Runs fn over items with at most `limit` in flight, keeping input order
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function writeCatalog(file, source, items) {
    const target = path.join(DATA_DIR, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const body = JSON.stringify({ source, updatedAt: new Date().toISOString(), count: items.length, items });
    // Write then rename, so a failed run never leaves a half-written file behind
    await fs.writeFile(`${target}.tmp`, body);
    await fs.rename(`${target}.tmp`, target);
    console.log(`Wrote ${items.length} titles to Data/${file}`);
}

function formatRuntime(minutes) {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

function yearOf(date) {
    return date ? date.slice(0, 4) : '';
}

// ---------------------------------------------------------------- TMDB

function tmdbClient(apiKey) {
    // v4 read access tokens are JWTs; v3 API keys are 32 hex characters
    const isToken = apiKey.startsWith('eyJ');
    return (endpoint, params = {}) => {
        const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
        for (const [k, v] of Object.entries({ language: 'en-US', ...params })) url.searchParams.set(k, String(v));
        if (!isToken) url.searchParams.set('api_key', apiKey);
        return fetchJson(url, isToken ? { headers: { Authorization: `Bearer ${apiKey}` } } : {});
    };
}

// TMDB names some genres differently from the IMDb data ("Science Fiction" vs
// "Sci-Fi") and joins TV genres ("Sci-Fi & Fantasy"); map them to the IMDb names
const TMDB_GENRE_NAMES = {
    'Science Fiction': ['Sci-Fi'],
    'Sci-Fi & Fantasy': ['Sci-Fi', 'Fantasy'],
    'Action & Adventure': ['Action', 'Adventure'],
    'War & Politics': ['War', 'Politics'],
    'TV Movie': [],
};

function tmdbGenres(genres = []) {
    return [...new Set(genres.flatMap(g => TMDB_GENRE_NAMES[g.name] ?? [g.name]))];
}

// Japanese animation is anime; AniList covers anime series, so TMDB's copies are skipped
function isJapaneseAnimation(item) {
    const genreIds = item.genre_ids ?? (item.genres ?? []).map(g => g.id);
    return item.original_language === 'ja' && genreIds.includes(16);
}

function topCast(credits, limit = 10) {
    return (credits?.cast ?? []).slice(0, limit).map(c => c.name);
}

function usCertification(releaseDates) {
    const us = releaseDates?.results?.find(r => r.iso_3166_1 === 'US');
    return us?.release_dates?.map(d => d.certification).find(Boolean) ?? '';
}

async function discoverIds(tmdb, endpoint, params, pages) {
    const ids = [];
    for (let page = 1; page <= pages; page++) {
        const data = await tmdb(endpoint, { ...params, page });
        ids.push(...data.results.map(r => r.id));
        if (page >= data.total_pages) break;
    }
    return ids;
}

async function fetchTmdbMovies(tmdb, { fromYear, toYear, moviePages }) {
    const ids = new Set();
    for (let year = toYear; year >= fromYear; year--) {
        const yearIds = await discoverIds(
            tmdb,
            '/discover/movie',
            { primary_release_year: year, sort_by: 'vote_count.desc', include_adult: false },
            moviePages,
        );
        yearIds.forEach(id => ids.add(id));
        process.stdout.write(`\rMovies: found ${ids.size} (year ${year})   `);
    }
    console.log();

    let done = 0;
    const movies = await mapLimit([...ids], TMDB_CONCURRENCY, async id => {
        const m = await tmdb(`/movie/${id}`, { append_to_response: 'credits,release_dates' });
        if (++done % 250 === 0) process.stdout.write(`\rMovies: fetched details for ${done}/${ids.size}   `);
        return {
            id: m.imdb_id || `tmdb-movie-${m.id}`,
            imdbId: m.imdb_id || undefined,
            type: isJapaneseAnimation(m) ? 'anime' : 'movie',
            format: isJapaneseAnimation(m) ? 'Movie' : undefined,
            title: m.title,
            year: yearOf(m.release_date),
            duration: formatRuntime(m.runtime),
            mpa: usCertification(m.release_dates),
            rating: m.vote_count > 0 ? Math.round(m.vote_average * 10) / 10 : null,
            votes: m.vote_count ?? 0,
            description: m.overview ?? '',
            link: m.imdb_id ? `https://www.imdb.com/title/${m.imdb_id}/` : `https://www.themoviedb.org/movie/${m.id}`,
            directors: (m.credits?.crew ?? []).filter(c => c.job === 'Director').map(c => c.name),
            stars: topCast(m.credits),
            genres: tmdbGenres(m.genres),
            languages: (m.spoken_languages ?? []).map(l => l.english_name || l.name).filter(Boolean),
            releaseDate: m.release_date ?? '',
            grossWorldwide: m.revenue || 0,
            poster: m.poster_path ? `${TMDB_IMAGE_URL}${m.poster_path}` : '',
        };
    });
    console.log();
    return movies.filter(m => m.title && m.year);
}

async function fetchTmdbSeries(tmdb, { seriesPages }) {
    const ids = new Set(await discoverIds(tmdb, '/discover/tv', { sort_by: 'vote_count.desc' }, seriesPages));
    // The most-voted list favours older shows, so add what's popular right now
    const recent = await discoverIds(
        tmdb,
        '/discover/tv',
        { sort_by: 'popularity.desc', 'first_air_date.gte': `${THIS_YEAR - 1}-01-01`, 'vote_count.gte': 20 },
        5,
    );
    recent.forEach(id => ids.add(id));
    console.log(`Series: found ${ids.size}`);

    let done = 0;
    const series = await mapLimit([...ids], TMDB_CONCURRENCY, async id => {
        const s = await tmdb(`/tv/${id}`, { append_to_response: 'credits,external_ids,content_ratings' });
        if (++done % 250 === 0) process.stdout.write(`\rSeries: fetched details for ${done}/${ids.size}   `);
        if (isJapaneseAnimation(s)) return null;
        const imdbId = s.external_ids?.imdb_id || undefined;
        const runtime = s.episode_run_time?.[0];
        return {
            id: `tmdb-tv-${s.id}`,
            imdbId,
            type: 'series',
            title: s.name,
            year: yearOf(s.first_air_date),
            duration: runtime ? `${formatRuntime(runtime)} per episode` : '',
            mpa: s.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating ?? '',
            rating: s.vote_count > 0 ? Math.round(s.vote_average * 10) / 10 : null,
            votes: s.vote_count ?? 0,
            description: s.overview ?? '',
            link: imdbId ? `https://www.imdb.com/title/${imdbId}/` : `https://www.themoviedb.org/tv/${s.id}`,
            directors: (s.created_by ?? []).map(c => c.name),
            stars: topCast(s.credits),
            genres: tmdbGenres(s.genres),
            languages: (s.spoken_languages ?? []).map(l => l.english_name || l.name).filter(Boolean),
            releaseDate: s.first_air_date ?? '',
            grossWorldwide: 0,
            poster: s.poster_path ? `${TMDB_IMAGE_URL}${s.poster_path}` : '',
            seasons: s.number_of_seasons ?? undefined,
            episodes: s.number_of_episodes ?? undefined,
            status: s.status ?? '',
            studios: (s.networks ?? []).map(n => n.name),
        };
    });
    console.log();
    return series.filter(s => s && s.title && s.year);
}

// ---------------------------------------------------------------- AniList

const ANILIST_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, format_in: [TV, TV_SHORT, ONA, OVA, SPECIAL]) {
      id
      siteUrl
      format
      status
      episodes
      duration
      countryOfOrigin
      title { romaji english }
      description(asHtml: false)
      startDate { year month day }
      genres
      averageScore
      popularity
      coverImage { large }
      studios(isMain: true) { nodes { name } }
    }
  }
}`;

const ANILIST_FORMATS = { TV: 'TV', TV_SHORT: 'TV Short', ONA: 'ONA', OVA: 'OVA', SPECIAL: 'Special' };
const ANILIST_STATUS = {
    FINISHED: 'Finished',
    RELEASING: 'Airing',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED: 'Cancelled',
    HIATUS: 'On hiatus',
};

function cleanAniListDescription(text) {
    return (text ?? '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\(Source:[^)]*\)/gi, '')
        .replace(/\[Written by[^\]]*\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isoDate({ year, month, day } = {}) {
    if (!year) return '';
    const pad = n => String(n).padStart(2, '0');
    return month ? `${year}-${pad(month)}${day ? `-${pad(day)}` : ''}` : String(year);
}

async function fetchAniListAnime({ animePages }) {
    const anime = [];
    for (let page = 1; page <= animePages; page++) {
        const { data, errors } = await fetchJson(ANILIST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: ANILIST_QUERY, variables: { page, perPage: 50 } }),
        });
        if (errors?.length) throw new Error(`AniList: ${errors.map(e => e.message).join('; ')}`);

        for (const a of data.Page.media) {
            const title = a.title.english || a.title.romaji;
            if (!title || !a.startDate?.year) continue;
            anime.push({
                id: `anilist-${a.id}`,
                type: 'anime',
                format: ANILIST_FORMATS[a.format] ?? a.format ?? '',
                title,
                // Keep the romaji name searchable when the English one is shown
                altTitle: a.title.english && a.title.romaji !== a.title.english ? a.title.romaji : undefined,
                year: String(a.startDate.year),
                duration: a.duration ? `${formatRuntime(a.duration)} per episode` : '',
                mpa: '',
                rating: a.averageScore ? a.averageScore / 10 : null,
                votes: a.popularity ?? 0,
                description: cleanAniListDescription(a.description),
                link: a.siteUrl,
                directors: [],
                stars: [],
                genres: a.genres ?? [],
                languages: a.countryOfOrigin === 'CN' ? ['Chinese'] : a.countryOfOrigin === 'KR' ? ['Korean'] : ['Japanese'],
                releaseDate: isoDate(a.startDate),
                grossWorldwide: 0,
                poster: a.coverImage?.large ?? '',
                episodes: a.episodes ?? undefined,
                status: ANILIST_STATUS[a.status] ?? '',
                studios: (a.studios?.nodes ?? []).map(s => s.name),
            });
        }
        process.stdout.write(`\rAnime: ${anime.length} titles (page ${page})   `);
        if (!data.Page.pageInfo.hasNextPage) break;
        await sleep(ANILIST_DELAY_MS);
    }
    console.log();
    return anime;
}

// ---------------------------------------------------------------- main

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const wantsTmdb = options.only.has('movies') || options.only.has('series');
    const apiKey = process.env.TMDB_API_KEY?.trim();

    if (wantsTmdb && !apiKey) {
        console.error(
            'TMDB_API_KEY is not set. Get a free key at https://www.themoviedb.org/settings/api,\n' +
                'or run with --only=anime to refresh anime only.',
        );
        process.exit(1);
    }

    // Each catalog is written as soon as it's done, so one failing doesn't lose the others
    const failures = [];
    const run = async (name, fn) => {
        try {
            await fn();
        } catch (error) {
            failures.push(name);
            console.error(`\nFailed to refresh ${name}: ${error.message}`);
        }
    };

    if (wantsTmdb) {
        const tmdb = tmdbClient(apiKey);
        if (options.only.has('movies')) {
            await run('movies', async () => writeCatalog('tmdb/movies.json', 'TMDB', await fetchTmdbMovies(tmdb, options)));
        }
        if (options.only.has('series')) {
            await run('series', async () => writeCatalog('tmdb/series.json', 'TMDB', await fetchTmdbSeries(tmdb, options)));
        }
    }
    if (options.only.has('anime')) {
        await run('anime', async () => writeCatalog('anilist/anime.json', 'AniList', await fetchAniListAnime(options)));
    }

    if (failures.length > 0) process.exit(1);
}

main();
