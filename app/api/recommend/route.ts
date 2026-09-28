import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

interface Movie {
    title: string;
    year: string;
    duration: string;
    mpa: string;
    rating: string;
    votes: string;
    metaScore: string;
    description: string;
    movieLink: string;
    directors: string;
    stars: string;
    genres: string;
    languages: string;
    releaseDate: string;
    budget: string;
    grossWorldwide: string;
}

interface RawMovieData {
    Title?: string;
    Year?: string;
    Duration?: string;
    MPA?: string;
    Rating?: string;
    Votes?: string;
    méta_score?: string;
    description?: string;
    'Movie Link'?: string;
    directors?: string;
    stars?: string;
    genres?: string;
    Languages?: string;
    release_date?: string;
    budget?: string;
    grossWorldWWide?: string;
}

// Cache for loaded movies
let moviesCache: Movie[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

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

async function loadMovies(): Promise<Movie[]> {
    // Check cache
    if (moviesCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
        return moviesCache;
    }

    const movies: Movie[] = [];
    const dataDir = path.join(process.cwd(), 'Data');

    try {
        const years = fs.readdirSync(dataDir);

        // Load all years
        const validYears = years
            .filter(year => !isNaN(parseInt(year)))
            .sort((a, b) => parseInt(b) - parseInt(a));

        for (const year of validYears) {
            const mergedFilePath = path.join(dataDir, year, `merged_movies_data_${year}.csv`);

            if (fs.existsSync(mergedFilePath)) {
                const fileContent = fs.readFileSync(mergedFilePath, 'utf-8');
                const parsed = Papa.parse<RawMovieData>(fileContent, {
                    header: true,
                    skipEmptyLines: true,
                });

                for (const row of parsed.data) {
                    if (row.Title && row.description) {
                        // Clean up the title (remove ranking number prefix)
                        const cleanTitle = row.Title.replace(/^\d+\.\s*/, '');

                        movies.push({
                            title: cleanTitle,
                            year: row.Year || year,
                            duration: row.Duration || '',
                            mpa: row.MPA || '',
                            rating: row.Rating || '',
                            votes: row.Votes || '',
                            metaScore: row['méta_score'] || '',
                            description: row.description || '',
                            movieLink: row['Movie Link'] || '',
                            directors: row.directors || '',
                            stars: row.stars || '',
                            genres: row.genres || '',
                            languages: row.Languages || '',
                            releaseDate: row.release_date || '',
                            budget: row.budget || '',
                            grossWorldwide: row.grossWorldWWide || '',
                        });
                    }
                }
            }
        }

        moviesCache = movies;
        cacheTimestamp = Date.now();

        return movies;
    } catch (error) {
        console.error('Error loading movies:', error);
        return [];
    }
}

function parseGenres(genresStr: string): string[] {
    try {
        const cleaned = genresStr.replace(/[\[\]']/g, '');
        return cleaned.split(',').map(g => g.trim()).filter(g => g.length > 0);
    } catch {
        return [];
    }
}

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

// Returns 0 when no search term matches, so non-matching movies can be dropped
function calculateRelevanceScore(movie: Movie, search: SearchQuery): number {
    let score = 0;
    let matchedTerms = 0;

    for (const { text, pattern } of search.terms) {
        // Each word counts for the best field it matches, plus a little for every
        // other field, so a word repeated in the description can't outweigh a
        // match on the director or cast
        const fieldScores: number[] = [];

        if (countMatches(movie.title, pattern) > 0) {
            fieldScores.push(movie.title.toLowerCase().startsWith(text) ? 40 : 30);
        }

        // Directors and cast weigh the same, so popularity decides between e.g.
        // Christopher Nolan's films and those starring Lloyd Nolan
        if (countMatches(movie.directors, pattern) > 0 || countMatches(movie.stars, pattern) > 0) {
            fieldScores.push(30);
        }

        if (countMatches(movie.genres, pattern) > 0) fieldScores.push(20);

        const descriptionMatches = countMatches(movie.description, pattern);
        if (descriptionMatches > 0) {
            fieldScores.push(10 + Math.min(descriptionMatches * 2, 6));
        }

        if (fieldScores.length > 0) {
            matchedTerms++;
            score += Math.max(...fieldScores) + (fieldScores.length - 1) * 5;
        }
    }

    // Only boost movies that actually matched the query
    if (score === 0) return 0;

    // The full query as a phrase ("tom hanks", "the godfather") beats scattered words
    if (search.phrase) {
        if (countMatches(movie.title, search.phrase) > 0) score += 50;
        if (countMatches(movie.directors, search.phrase) > 0 || countMatches(movie.stars, search.phrase) > 0) {
            score += 50;
        }
    }

    // Exact title ("Up", "Heat") beats titles that merely contain the words
    if (movie.title.toLowerCase() === search.text) score += 40;

    // Movies matching only some of the words rank below ones matching all of them
    score *= matchedTerms / search.terms.length;

    // Boost by rating
    const rating = parseFloat(movie.rating);
    if (!isNaN(rating)) {
        score += rating * 2;
    }

    // Boost by popularity on a log scale (1K votes -> 9, 1M votes -> 18)
    const voteNum = parseVotes(movie.votes);
    score += Math.log10(voteNum + 1) * 3;

    return score;
}

// Get all unique genres from movies
function extractAllGenres(movies: Movie[]): string[] {
    const genreSet = new Set<string>();
    for (const movie of movies) {
        const genres = parseGenres(movie.genres);
        genres.forEach(g => genreSet.add(g));
    }
    return Array.from(genreSet).sort();
}

// Get all available years
function extractAllYears(movies: Movie[]): string[] {
    const yearSet = new Set<string>();
    for (const movie of movies) {
        if (movie.year) yearSet.add(movie.year);
    }
    return Array.from(yearSet).sort((a, b) => parseInt(b) - parseInt(a));
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query') || '';
    const limit = parseInt(searchParams.get('limit') || '20');
    const genre = searchParams.get('genre') || '';
    const minRating = parseFloat(searchParams.get('minRating') || '0');
    const maxRating = parseFloat(searchParams.get('maxRating') || '10');
    const year = searchParams.get('year') || '';
    const yearFrom = searchParams.get('yearFrom') || '';
    const yearTo = searchParams.get('yearTo') || '';
    const sortBy = searchParams.get('sortBy') || 'relevance'; // relevance, rating, votes, year, gross
    const language = searchParams.get('language') || '';
    const mpa = searchParams.get('mpa') || '';
    const getFiltersOnly = searchParams.get('getFilters') === 'true';

    try {
        const movies = await loadMovies();

        // If only requesting filter options
        if (getFiltersOnly) {
            return NextResponse.json({
                genres: extractAllGenres(movies),
                years: extractAllYears(movies),
                totalMovies: movies.length,
                mpaRatings: ['G', 'PG', 'PG-13', 'R', 'NC-17', 'Not Rated'],
            });
        }

        // Filter movies
        let filteredMovies = movies.filter(movie => {
            // Genre filter (exact match, so "Drama" doesn't also match "Docudrama")
            if (genre) {
                const wanted = genre.toLowerCase();
                if (!parseGenres(movie.genres).some(g => g.toLowerCase() === wanted)) {
                    return false;
                }
            }

            // Single year filter
            if (year) {
                if (movie.year !== year) {
                    return false;
                }
            }

            // Year range filter
            if (yearFrom || yearTo) {
                const movieYear = parseInt(movie.year);
                if (yearFrom && movieYear < parseInt(yearFrom)) return false;
                if (yearTo && movieYear > parseInt(yearTo)) return false;
            }

            // Rating filter
            const movieRating = parseFloat(movie.rating);
            if (!isNaN(movieRating)) {
                if (movieRating < minRating) return false;
                if (maxRating < 10 && movieRating > maxRating) return false;
            } else if (minRating > 0) {
                return false; // Exclude unrated movies if min rating is set
            }

            // Language filter
            if (language) {
                const movieLangs = movie.languages.toLowerCase();
                if (!movieLangs.includes(language.toLowerCase())) {
                    return false;
                }
            }

            // MPA rating filter
            if (mpa) {
                if (movie.mpa !== mpa) {
                    return false;
                }
            }

            return true;
        });

        // If there's a query, score by relevance
        if (query) {
            const search = buildSearchQuery(query);

            const scoredMovies = filteredMovies.map(movie => ({
                movie,
                score: calculateRelevanceScore(movie, search),
            }));

            // Filter out zero scores
            filteredMovies = scoredMovies
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(item => item.movie);
        }

        // Apply sorting
        switch (sortBy) {
            case 'rating':
                filteredMovies.sort((a, b) => {
                    const ratingA = parseFloat(a.rating) || 0;
                    const ratingB = parseFloat(b.rating) || 0;
                    return ratingB - ratingA;
                });
                break;
            case 'votes':
                filteredMovies.sort((a, b) => {
                    const votesA = parseVotes(a.votes);
                    const votesB = parseVotes(b.votes);
                    return votesB - votesA;
                });
                break;
            case 'year':
                filteredMovies.sort((a, b) => {
                    const yearA = parseInt(a.year) || 0;
                    const yearB = parseInt(b.year) || 0;
                    return yearB - yearA;
                });
                break;
            case 'gross':
                filteredMovies.sort((a, b) => {
                    const grossA = parseGross(a.grossWorldwide);
                    const grossB = parseGross(b.grossWorldwide);
                    return grossB - grossA;
                });
                break;
            case 'relevance':
            default:
                // Already sorted by relevance if query exists
                if (!query) {
                    // Default to rating if no query
                    filteredMovies.sort((a, b) => {
                        const ratingA = parseFloat(a.rating) || 0;
                        const ratingB = parseFloat(b.rating) || 0;
                        return ratingB - ratingA;
                    });
                }
                break;
        }

        // Limit results
        const results = filteredMovies.slice(0, limit).map(movie => ({
            ...movie,
            genres: parseGenres(movie.genres),
            votesNum: parseVotes(movie.votes),
            grossNum: parseGross(movie.grossWorldwide),
        }));

        return NextResponse.json({
            results,
            total: filteredMovies.length,
            query,
            filters: {
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
