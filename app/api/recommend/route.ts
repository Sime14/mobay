import { NextRequest, NextResponse } from 'next/server';
import { loadCatalog, type IndexedTitle } from '@/lib/catalog';
import type { Title, TitleType } from '@/lib/types';

const TITLE_TYPES: TitleType[] = ['movie', 'series', 'anime'];
const MAX_LIMIT = 100;

// Common words that say nothing about which movie is wanted
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'about', 'into', 'movie', 'movies', 'film', 'films',
    'a', 'an', 'of', 'in', 'on', 'to', 'at', 'by', 'is', 'it',
]);

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches the words as whole words (so "up" doesn't match "Superman"), case-insensitive
function wordPattern(words: string[]): RegExp {
    const body = words.map(escapeRegExp).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

function countMatches(text: string, pattern: RegExp): number {
    return text.match(pattern)?.length ?? 0;
}

interface SearchQuery {
    terms: { text: string; pattern: RegExp }[];
    // The whole query as a phrase, when it has more than one word (e.g. "christopher nolan")
    phrase: RegExp | null;
    // The whole query, lowercased and with single spaces
    text: string;
}

function buildSearchQuery(query: string): SearchQuery {
    const allWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const keywords = allWords.filter(w => !STOP_WORDS.has(w));
    // Fall back to every word when the query is only stop words (e.g. "the")
    const words = keywords.length > 0 ? keywords : allWords;

    return {
        terms: words.map(text => ({ text, pattern: wordPattern([text]) })),
        phrase: allWords.length > 1 ? wordPattern(allWords) : null,
        text: allWords.join(' '),
    };
}

// Returns 0 when no search term matches, so non-matching titles can be dropped
function calculateRelevanceScore(indexed: IndexedTitle, search: SearchQuery): number {
    const title = indexed.item;
    let score = 0;
    let matchedTerms = 0;

    for (const { text, pattern } of search.terms) {
        // Each word counts for the best field it matches, plus a little for every
        // other field, so a word repeated in the description can't outweigh a
        // match on the director or cast
        const fieldScores: number[] = [];

        if (countMatches(indexed.searchTitle, pattern) > 0) {
            fieldScores.push(title.title.toLowerCase().startsWith(text) ? 40 : 30);
        }

        // Directors, cast and studios weigh the same, so popularity decides between
        // e.g. Christopher Nolan's films and those starring Lloyd Nolan
        if (countMatches(indexed.searchPeople, pattern) > 0) fieldScores.push(30);

        if (countMatches(indexed.searchGenres, pattern) > 0) fieldScores.push(20);

        const descriptionMatches = countMatches(title.description, pattern);
        if (descriptionMatches > 0) {
            fieldScores.push(10 + Math.min(descriptionMatches * 2, 6));
        }

        if (fieldScores.length > 0) {
            matchedTerms++;
            score += Math.max(...fieldScores) + (fieldScores.length - 1) * 5;
        }
    }

    // Only boost titles that actually matched the query
    if (score === 0) return 0;

    // The full query as a phrase ("tom hanks", "the godfather") beats scattered words
    if (search.phrase) {
        if (countMatches(indexed.searchTitle, search.phrase) > 0) score += 50;
        if (countMatches(indexed.searchPeople, search.phrase) > 0) score += 50;
    }

    // Exact title ("Up", "Heat") beats titles that merely contain the words
    if (title.title.toLowerCase() === search.text || title.altTitle?.toLowerCase() === search.text) {
        score += 40;
    }

    // Titles matching only some of the words rank below ones matching all of them
    score *= matchedTerms / search.terms.length;

    // Boost by rating
    if (title.rating !== null) {
        score += title.rating * 2;
    }

    // Boost by popularity on a log scale (1K votes -> 9, 1M votes -> 18)
    score += Math.log10(title.votes + 1) * 3;

    return score;
}

// Rating pulled toward an average of 6.5 when there are few votes, so a title
// rated 10 by three people doesn't top "Top Rated"
function weightedRating(title: Title): number {
    if (title.rating === null) return 0;
    const minVotes = 1000;
    return (title.votes * title.rating + minVotes * 6.5) / (title.votes + minVotes);
}

function extractAllGenres(titles: Title[]): string[] {
    return [...new Set(titles.flatMap(t => t.genres))].sort();
}

function extractAllYears(titles: Title[]): string[] {
    return [...new Set(titles.map(t => t.year).filter(Boolean))].sort((a, b) => parseInt(b) - parseInt(a));
}

function countByType(titles: Title[]): Record<TitleType, number> {
    const counts: Record<TitleType, number> = { movie: 0, series: 0, anime: 0 };
    for (const t of titles) counts[t.type]++;
    return counts;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query') || '';
    const requestedLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, MAX_LIMIT) : 20;
    const type = searchParams.get('type') || '';
    const genre = searchParams.get('genre') || '';
    const minRating = parseFloat(searchParams.get('minRating') || '0') || 0;
    const maxRating = parseFloat(searchParams.get('maxRating') || '10') || 10;
    const year = searchParams.get('year') || '';
    const yearFrom = searchParams.get('yearFrom') || '';
    const yearTo = searchParams.get('yearTo') || '';
    const sortBy = searchParams.get('sortBy') || 'relevance'; // relevance, rating, votes, year, gross
    const language = searchParams.get('language') || '';
    const mpa = searchParams.get('mpa') || '';
    const getFiltersOnly = searchParams.get('getFilters') === 'true';

    try {
        const catalog = loadCatalog();
        const titles = catalog.map(indexed => indexed.item);

        // If only requesting filter options
        if (getFiltersOnly) {
            return NextResponse.json({
                genres: extractAllGenres(titles),
                years: extractAllYears(titles),
                totalMovies: titles.length,
                typeCounts: countByType(titles),
                mpaRatings: ['G', 'PG', 'PG-13', 'R', 'NC-17', 'Not Rated'],
            });
        }

        let filtered = catalog.filter(({ item: title }) => {
            if (TITLE_TYPES.includes(type as TitleType) && title.type !== type) return false;

            // Genre filter (exact match, so "Drama" doesn't also match "Docudrama")
            if (genre) {
                const wanted = genre.toLowerCase();
                if (!title.genres.some(g => g.toLowerCase() === wanted)) return false;
            }

            if (year && title.year !== year) return false;

            if (yearFrom || yearTo) {
                const titleYear = parseInt(title.year);
                if (yearFrom && titleYear < parseInt(yearFrom)) return false;
                if (yearTo && titleYear > parseInt(yearTo)) return false;
            }

            if (title.rating !== null) {
                if (title.rating < minRating) return false;
                if (maxRating < 10 && title.rating > maxRating) return false;
            } else if (minRating > 0) {
                return false; // Exclude unrated titles if min rating is set
            }

            if (language) {
                const wanted = language.toLowerCase();
                if (!title.languages.some(l => l.toLowerCase().includes(wanted))) return false;
            }

            if (mpa && title.mpa !== mpa) return false;

            return true;
        });

        // If there's a query, score by relevance
        if (query) {
            const search = buildSearchQuery(query);
            filtered = filtered
                .map(indexed => ({ indexed, score: calculateRelevanceScore(indexed, search) }))
                .filter(result => result.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(result => result.indexed);
        }

        const results = filtered.map(indexed => indexed.item);
        const byRating = (a: Title, b: Title) => weightedRating(b) - weightedRating(a);
        switch (sortBy) {
            case 'rating':
                results.sort(byRating);
                break;
            case 'votes':
                results.sort((a, b) => b.votes - a.votes);
                break;
            case 'year':
                results.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
                break;
            case 'gross':
                results.sort((a, b) => b.grossWorldwide - a.grossWorldwide);
                break;
            case 'relevance':
            default:
                // Already sorted by relevance if there's a query; otherwise best rated first
                if (!query) results.sort(byRating);
                break;
        }

        return NextResponse.json({
            results: results.slice(0, limit),
            total: results.length,
            query,
            filters: {
                type,
                genre,
                year,
                yearFrom,
                yearTo,
                minRating,
                maxRating,
                sortBy,
                language,
                mpa,
            },
        });
    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Failed to search movies' }, { status: 500 });
    }
}
