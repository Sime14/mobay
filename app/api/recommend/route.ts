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

function calculateRelevanceScore(movie: Movie, searchTerms: string[]): number {
    let score = 0;
    const title = movie.title.toLowerCase();
    const description = movie.description.toLowerCase();
    const genres = movie.genres.toLowerCase();
    const stars = movie.stars.toLowerCase();
    const directors = movie.directors.toLowerCase();

    for (const term of searchTerms) {
        const lowerTerm = term.toLowerCase();

        // Title match (highest weight)
        if (title.includes(lowerTerm)) {
            score += 30;
            if (title.startsWith(lowerTerm)) score += 10;
        }

        // Description match (high weight)
        if (description.includes(lowerTerm)) {
            score += 15;
            const occurrences = (description.match(new RegExp(lowerTerm, 'gi')) || []).length;
            score += Math.min(occurrences * 2, 10);
        }

        // Genre match
        if (genres.includes(lowerTerm)) {
            score += 20;
        }

        // Stars match
        if (stars.includes(lowerTerm)) {
            score += 10;
        }

        // Directors match
        if (directors.includes(lowerTerm)) {
            score += 8;
        }
    }

    // Boost by rating
    const rating = parseFloat(movie.rating);
    if (!isNaN(rating)) {
        score += rating * 2;
    }

    // Boost by vote count (popularity)
    const voteNum = parseVotes(movie.votes);
    score += Math.min(voteNum / 10000, 5);

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
            // Genre filter
            if (genre) {
                const movieGenres = movie.genres.toLowerCase();
                if (!movieGenres.includes(genre.toLowerCase())) {
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
            const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

            const scoredMovies = filteredMovies.map(movie => ({
                movie,
                score: calculateRelevanceScore(movie, searchTerms),
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
