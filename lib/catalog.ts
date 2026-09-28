import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import type { Title } from './types';

// Loads the IMDb CSVs in Data/<year>/ plus the TMDB and AniList catalogs that
// scripts/update-data.mjs writes, merged into one list of titles

const DATA_DIR = path.join(process.cwd(), 'Data');
const CATALOG_FILES = ['tmdb/movies.json', 'tmdb/series.json', 'anilist/anime.json'];

interface RawMovieData {
    Title?: string;
    Year?: string;
    Duration?: string;
    MPA?: string;
    Rating?: string;
    Votes?: string;
    description?: string;
    'Movie Link'?: string;
    directors?: string;
    stars?: string;
    genres?: string;
    Languages?: string;
    release_date?: string;
    grossWorldWWide?: string;
}

// A title plus its searchable text, built once at load time instead of per request
export interface IndexedTitle {
    item: Title;
    searchTitle: string;
    searchPeople: string;
    searchGenres: string;
}

// Parse votes string to number (e.g., "212K" -> 212000, "1.5M" -> 1500000)
function parseVotes(votesStr: string): number {
    if (!votesStr) return 0;
    const cleaned = votesStr.replace(/,/g, '').trim();
    const match = cleaned.match(/^([\d.]+)([KM])?$/i);
    if (!match) return parseFloat(cleaned) || 0;

    let num = parseFloat(match[1]);
    const suffix = match[2]?.toUpperCase();
    if (suffix === 'K') num *= 1000;
    if (suffix === 'M') num *= 1000000;
    return num;
}

// Parse gross/budget string to number
function parseGross(grossStr: string): number {
    if (!grossStr) return 0;
    const match = grossStr.match(/\$?([\d,]+)/);
    if (!match) return 0;
    return parseFloat(match[1].replace(/,/g, '')) || 0;
}

// Parse a Python list literal from the CSVs: "['Joe Pesci', \"Catherine O'Hara\"]"
function parseListLiteral(text: string | undefined): string[] {
    if (!text) return [];
    const items: string[] = [];
    for (const match of text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
        const item = (match[1] ?? match[2]).replace(/\\(.)/g, '$1').trim();
        if (item) items.push(item);
    }
    return items;
}

function index(title: Title): IndexedTitle {
    return {
        item: title,
        searchTitle: [title.title, title.altTitle].filter(Boolean).join(' | '),
        searchPeople: [...title.directors, ...title.stars, ...(title.studios ?? [])].join(' | '),
        searchGenres: title.genres.join(' | '),
    };
}

function loadCsvTitles(): Title[] {
    const titles: Title[] = [];
    const years = fs
        .readdirSync(DATA_DIR)
        .filter(year => /^\d{4}$/.test(year))
        .sort((a, b) => parseInt(b) - parseInt(a));

    for (const year of years) {
        const file = path.join(DATA_DIR, year, `merged_movies_data_${year}.csv`);
        if (!fs.existsSync(file)) continue;

        const parsed = Papa.parse<RawMovieData>(fs.readFileSync(file, 'utf-8'), {
            header: true,
            skipEmptyLines: true,
        });

        parsed.data.forEach((row, i) => {
            if (!row.Title || !row.description) return;
            const link = row['Movie Link'] || '';
            const imdbId = link.match(/\/title\/(tt\d+)/)?.[1];
            const genres = parseListLiteral(row.genres);
            const rating = parseFloat(row.Rating || '');
            const isAnime = genres.includes('Anime');

            titles.push({
                id: imdbId ?? `imdb-${year}-${i}`,
                type: isAnime ? 'anime' : 'movie',
                format: isAnime ? 'Movie' : undefined,
                // Remove the ranking number prefix ("1. Barbie")
                title: row.Title.replace(/^\d+\.\s*/, ''),
                year: row.Year || year,
                duration: row.Duration || '',
                mpa: row.MPA || '',
                rating: Number.isFinite(rating) ? rating : null,
                votes: parseVotes(row.Votes || ''),
                description: row.description,
                link,
                directors: parseListLiteral(row.directors),
                stars: parseListLiteral(row.stars),
                genres,
                languages: parseListLiteral(row.Languages),
                releaseDate: row.release_date || '',
                grossWorldwide: parseGross(row.grossWorldWWide || ''),
                poster: '',
            });
        });
    }
    return titles;
}

function loadCatalogFile(file: string): Title[] {
    const fullPath = path.join(DATA_DIR, file);
    if (!fs.existsSync(fullPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(fullPath, 'utf-8')).items ?? [];
    } catch (error) {
        console.error(`Skipping unreadable catalog ${file}:`, error);
        return [];
    }
}

// Adds TMDB/AniList titles to the IMDb ones. A TMDB movie that is already in the
// CSVs (same IMDb id) only fills in what the CSV lacks, such as the poster; the
// IMDb rating and votes are kept since they come from far more voters
function mergeCatalogs(base: Title[], extra: Title[]): Title[] {
    const byId = new Map<string, Title>();
    for (const title of base) {
        if (!byId.has(title.id)) byId.set(title.id, title);
    }

    for (const title of extra) {
        const existing = byId.get(title.id);
        if (!existing) {
            byId.set(title.id, title);
            continue;
        }
        existing.poster ||= title.poster;
        existing.mpa ||= title.mpa;
        existing.duration ||= title.duration;
        existing.description ||= title.description;
        existing.grossWorldwide ||= title.grossWorldwide;
        if (existing.directors.length === 0) existing.directors = title.directors;
        if (existing.stars.length === 0) existing.stars = title.stars;
        if (existing.languages.length === 0) existing.languages = title.languages;
        if (title.type === 'anime') {
            existing.type = 'anime';
            existing.format = title.format;
        }
    }
    return [...byId.values()];
}

let cache: IndexedTitle[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export function loadCatalog(): IndexedTitle[] {
    if (cache && Date.now() - cacheTimestamp < CACHE_DURATION) {
        return cache;
    }

    try {
        const extra = CATALOG_FILES.flatMap(loadCatalogFile);
        cache = mergeCatalogs(loadCsvTitles(), extra).map(index);
        cacheTimestamp = Date.now();
        return cache;
    } catch (error) {
        console.error('Error loading catalog:', error);
        return [];
    }
}
