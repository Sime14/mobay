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

async function loadMovies(): Promise<Movie[]> {
    // Check cache
    if (moviesCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
        return moviesCache;
    }

    const movies: Movie[] = [];
    const dataDir = path.join(process.cwd(), 'Data');

    try {
        const years = fs.readdirSync(dataDir);

        // Load data from recent years for better performance (last 30 years)
        const recentYears = years
            .filter(year => !isNaN(parseInt(year)) && parseInt(year) >= 1995)
            .sort((a, b) => parseInt(b) - parseInt(a));

        for (const year of recentYears) {
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
        // Remove brackets and split
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
            // Count occurrences
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
    const votes = movie.votes.replace(/[KM]/gi, '');
    let voteNum = parseFloat(votes);
    if (!isNaN(voteNum)) {
        if (movie.votes.toUpperCase().includes('M')) voteNum *= 1000;
        score += Math.min(voteNum / 100, 5);
    }

    return score;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query') || '';
    const limit = parseInt(searchParams.get('limit') || '10');
    const genre = searchParams.get('genre') || '';
    const minRating = parseFloat(searchParams.get('minRating') || '0');
    const year = searchParams.get('year') || '';

    if (!query && !genre && !year) {
        return NextResponse.json({ error: 'Please provide a search query, genre, or year' }, { status: 400 });
    }

    try {
        const movies = await loadMovies();

        // Filter movies
        let filteredMovies = movies.filter(movie => {
            // Genre filter
            if (genre) {
                const movieGenres = movie.genres.toLowerCase();
                if (!movieGenres.includes(genre.toLowerCase())) {
                    return false;
                }
            }

            // Year filter
            if (year) {
                if (!movie.year.includes(year)) {
                    return false;
                }
            }

            // Rating filter
            const movieRating = parseFloat(movie.rating);
            if (!isNaN(movieRating) && movieRating < minRating) {
                return false;
            }

            return true;
        });

        // If there's a query, score and sort by relevance
        if (query) {
            const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

            const scoredMovies = filteredMovies.map(movie => ({
                movie,
                score: calculateRelevanceScore(movie, searchTerms),
            }));

            // Filter out zero scores and sort by score
            filteredMovies = scoredMovies
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(item => item.movie);
        } else {
            // Sort by rating if no query
            filteredMovies.sort((a, b) => {
                const ratingA = parseFloat(a.rating) || 0;
                const ratingB = parseFloat(b.rating) || 0;
                return ratingB - ratingA;
            });
        }

        // Limit results
        const results = filteredMovies.slice(0, limit).map(movie => ({
            ...movie,
            genres: parseGenres(movie.genres),
        }));

        return NextResponse.json({
            results,
            total: filteredMovies.length,
            query,
        });

    } catch (error) {
        console.error('Search error:', error);
        return NextResponse.json({ error: 'Failed to search movies' }, { status: 500 });
    }
}
