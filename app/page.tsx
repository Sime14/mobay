'use client';

import { useState, FormEvent } from 'react';

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
  genres: string[];
  languages: string;
  releaseDate: string;
}

interface SearchResponse {
  results: Movie[];
  total: number;
  query: string;
}

// Parse array-like strings from CSV
function parseArrayString(str: string): string[] {
  try {
    const cleaned = str.replace(/[\[\]']/g, '');
    return cleaned.split(',').map(s => s.trim()).filter(s => s.length > 0).slice(0, 3);
  } catch {
    return [];
  }
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const response = await fetch(`/api/recommend?query=${encodeURIComponent(query)}&limit=12`);
      const data: SearchResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.query || 'Failed to fetch recommendations');
      }

      setMovies(data.results);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setMovies([]);
    } finally {
      setLoading(false);
    }
  };

  const exampleQueries = [
    "mind-bending sci-fi thriller",
    "heartwarming family adventure",
    "intense action with great villain",
    "romantic comedy in new york",
    "psychological horror mystery",
    "epic fantasy adventure"
  ];

  const handleExampleClick = (example: string) => {
    setQuery(example);
  };

  return (
    <div className="gradient-bg min-h-screen relative">
      <div className="relative z-10">
        {/* Header */}
        <header className="pt-12 pb-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto text-center">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-4">
              <span className="text-gradient">CineMatch</span>
              <span className="text-white"> AI</span>
            </h1>
            <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto">
              Describe the movie you&apos;re in the mood for, and we&apos;ll find the perfect match from over 100 years of cinema.
            </p>
          </div>
        </header>

        {/* Search Section */}
        <section className="px-4 sm:px-6 lg:px-8 pb-12">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSearch} className="relative">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., A thrilling space adventure with mystery..."
                    className="search-input pr-12"
                  />
                  <svg
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <button
                  type="submit"
                  disabled={loading || !query.trim()}
                  className="gradient-button whitespace-nowrap"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Searching...
                    </span>
                  ) : (
                    'Find Movies'
                  )}
                </button>
              </div>
            </form>

            {/* Example Queries */}
            <div className="mt-6">
              <p className="text-sm text-zinc-500 mb-3">Try searching for:</p>
              <div className="flex flex-wrap gap-2">
                {exampleQueries.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => handleExampleClick(example)}
                    className="text-sm px-3 py-1.5 rounded-full bg-white/5 text-zinc-400 
                             hover:bg-white/10 hover:text-white transition-all duration-200
                             border border-white/10 hover:border-white/20"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Results Section */}
        <section className="px-4 sm:px-6 lg:px-8 pb-20">
          <div className="max-w-7xl mx-auto">
            {/* Error Message */}
            {error && (
              <div className="text-center py-12">
                <div className="glass-card inline-block px-6 py-4 text-red-400">
                  <p>{error}</p>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="loader mb-4"></div>
                <p className="text-zinc-400">Finding your perfect movies...</p>
              </div>
            )}

            {/* Results */}
            {!loading && searched && movies.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-semibold text-white">
                    Recommended for you
                  </h2>
                  <span className="text-zinc-500">
                    {total} movie{total !== 1 ? 's' : ''} found
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 stagger-children">
                  {movies.map((movie, index) => (
                    <MovieCard key={index} movie={movie} />
                  ))}
                </div>
              </>
            )}

            {/* No Results */}
            {!loading && searched && movies.length === 0 && !error && (
              <div className="text-center py-20">
                <div className="text-6xl mb-4">🎬</div>
                <h3 className="text-xl font-semibold text-white mb-2">No movies found</h3>
                <p className="text-zinc-400">
                  Try a different description or browse by genre
                </p>
              </div>
            )}

            {/* Initial State */}
            {!searched && !loading && (
              <div className="text-center py-20">
                <div className="text-8xl mb-6">🍿</div>
                <h3 className="text-2xl font-semibold text-white mb-3">
                  Ready to discover your next favorite movie?
                </h3>
                <p className="text-zinc-400 max-w-md mx-auto">
                  Describe what you&apos;re looking for above. Try including genres, moods,
                  themes, or even actor names!
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/10 py-8 px-4">
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-zinc-500 text-sm">
              Movie data sourced from 1995-2025 • Over 15,000+ films indexed
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function MovieCard({ movie }: { movie: Movie }) {
  const directors = parseArrayString(movie.directors);
  const stars = parseArrayString(movie.stars);
  const genres = Array.isArray(movie.genres) ? movie.genres : parseArrayString(movie.genres as unknown as string);

  return (
    <a
      href={movie.movieLink || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="glass-card p-5 block group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-semibold text-white group-hover:text-indigo-300 transition-colors line-clamp-2 flex-1">
          {movie.title}
        </h3>
        {movie.rating && (
          <span className="rating-badge flex-shrink-0">
            ⭐ {movie.rating}
          </span>
        )}
      </div>

      {/* Meta Info */}
      <div className="flex items-center gap-3 text-sm text-zinc-400 mb-3">
        <span>{movie.year}</span>
        {movie.duration && (
          <>
            <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
            <span>{movie.duration}</span>
          </>
        )}
        {movie.mpa && (
          <>
            <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
            <span className="px-1.5 py-0.5 bg-white/10 rounded text-xs">{movie.mpa}</span>
          </>
        )}
      </div>

      {/* Genres */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {genres.slice(0, 3).map((genre, idx) => (
            <span key={idx} className="genre-tag">
              {genre}
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      <p className="text-sm text-zinc-400 line-clamp-3 mb-4">
        {movie.description}
      </p>

      {/* Directors & Stars */}
      <div className="space-y-1 text-xs text-zinc-500">
        {directors.length > 0 && (
          <p>
            <span className="text-zinc-600">Director:</span> {directors.join(', ')}
          </p>
        )}
        {stars.length > 0 && (
          <p>
            <span className="text-zinc-600">Stars:</span> {stars.join(', ')}
          </p>
        )}
      </div>

      {/* View Link */}
      <div className="mt-4 pt-3 border-t border-white/10">
        <span className="text-sm text-indigo-400 group-hover:text-indigo-300 flex items-center gap-1">
          View on IMDb
          <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </span>
      </div>
    </a>
  );
}
