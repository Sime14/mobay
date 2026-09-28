'use client';

import { useState, useEffect, FormEvent } from 'react';

interface Movie {
  title: string;
  year: string;
  duration: string;
  mpa: string;
  rating: string;
  votes: string;
  votesNum: number;
  description: string;
  movieLink: string;
  directors: string;
  stars: string;
  genres: string[];
  languages: string;
  releaseDate: string;
  grossWorldwide: string;
  grossNum: number;
}

interface SearchResponse {
  results: Movie[];
  total: number;
  query: string;
}

interface FiltersResponse {
  genres: string[];
  years: string[];
  totalMovies: number;
  mpaRatings: string[];
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

// Format large numbers (e.g. 3000000 -> "3.0M")
function formatNumber(num: number): string {
  if (num >= 1000000000) return `${(num / 1000000000).toFixed(1)}B`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Format money amounts (e.g. 1447038421 -> "$1.4B")
function formatCurrency(num: number): string {
  return `$${formatNumber(num)}`;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [minRating, setMinRating] = useState('0');
  const [sortBy, setSortBy] = useState('relevance');

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Available filter options
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [totalMoviesCount, setTotalMoviesCount] = useState(0);

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initialTheme = prefersDark ? 'dark' : 'light';
      setTheme(initialTheme);
      if (prefersDark) {
        document.documentElement.classList.add('dark');
      }
    }
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);

    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Load filter options on mount
  useEffect(() => {
    async function loadFilters() {
      try {
        const response = await fetch('/api/recommend?getFilters=true');
        const data: FiltersResponse = await response.json();
        setAvailableGenres(data.genres || []);
        setAvailableYears(data.years || []);
        setTotalMoviesCount(data.totalMovies || 0);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    loadFilters();
  }, []);

  const buildSearchUrl = () => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (genre) params.set('genre', genre);
    if (year) params.set('year', year);
    if (minRating !== '0') params.set('minRating', minRating);
    if (sortBy !== 'relevance') params.set('sortBy', sortBy);
    params.set('limit', '24');
    return `/api/recommend?${params.toString()}`;
  };

  const handleSearch = async (e?: FormEvent) => {
    if (e) e.preventDefault();

    if (!query.trim() && !genre && !year && minRating === '0') {
      setError('Please enter a search term or select a filter');
      return;
    }

    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const response = await fetch(buildSearchUrl());
      const data: SearchResponse = await response.json();

      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
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

  const handleQuickFilter = async (filterType: string, value?: string) => {
    setSearched(true);
    setLoading(true);
    setError('');

    // Reset other filters when using quick filter
    setQuery('');
    setGenre('');
    setYear('');
    setMinRating('0');

    let url = '/api/recommend?limit=24';

    switch (filterType) {
      case 'topRated':
        url += '&sortBy=rating&minRating=7';
        setSortBy('rating');
        setMinRating('7');
        break;
      case 'mostPopular':
        url += '&sortBy=votes';
        setSortBy('votes');
        break;
      case 'boxOffice':
        url += '&sortBy=gross';
        setSortBy('gross');
        break;
      case 'year':
        url += `&year=${value}&sortBy=rating`;
        setYear(value || '');
        setSortBy('rating');
        break;
      case 'genre':
        url += `&genre=${encodeURIComponent(value || '')}&sortBy=rating`;
        setGenre(value || '');
        setSortBy('rating');
        break;
    }

    try {
      const response = await fetch(url);
      const data: SearchResponse = await response.json();
      setMovies(data.results);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setMovies([]);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setGenre('');
    setYear('');
    setMinRating('0');
    setSortBy('relevance');
    setQuery('');
    setSearched(false);
    setMovies([]);
  };

  const activeFiltersCount = [genre, year, minRating !== '0', sortBy !== 'relevance'].filter(Boolean).length;

  const exampleQueries = [
    "mind-bending sci-fi thriller",
    "heartwarming family adventure",
    "intense action great villain",
    "romantic comedy",
  ];

  const popularGenres = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'Thriller', 'Animation'];
  const recentYears = ['2024', '2023', '2022', '2021', '2020'];

  return (
    <div className="page-container">
      <div className="relative z-10">
        {/* Header */}
        <header className="pt-12 pb-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1"></div>
              <button
                onClick={toggleTheme}
                className="btn-secondary p-2.5 rounded-lg"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
            </div>
            <div className="text-center">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-4 tracking-tight">
                <span className="text-gradient">Mobay</span>
              </h1>
              <p className="text-lg text-muted max-w-xl mx-auto">
                Discover your next favorite movie from {totalMoviesCount.toLocaleString()}+ films
              </p>
            </div>
          </div>
        </header>

        {/* Quick Filters Bar */}
        <section className="px-4 sm:px-6 lg:px-8 pb-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-wrap items-center justify-center gap-3 mb-5">
              <button onClick={() => handleQuickFilter('topRated')} className="quick-filter gold">
                ⭐ Top Rated
              </button>
              <button onClick={() => handleQuickFilter('mostPopular')} className="quick-filter pink">
                🔥 Most Popular
              </button>
              <button onClick={() => handleQuickFilter('boxOffice')} className="quick-filter green">
                💰 Box Office Hits
              </button>
            </div>

            {/* Year Quick Filters */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-muted text-sm mr-1">Browse by year:</span>
              {recentYears.map(y => (
                <button
                  key={y}
                  onClick={() => handleQuickFilter('year', y)}
                  className={`filter-pill ${year === y ? 'active' : ''}`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Search Section */}
        <section className="px-4 sm:px-6 lg:px-8 pb-8">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSearch} className="relative">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Describe what you're looking for..."
                    className="search-input pr-12"
                  />
                  <svg
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className={`btn-secondary flex items-center gap-2 ${showFilters || activeFiltersCount > 0 ? 'border-primary text-primary' : ''}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Filters
                  {activeFiltersCount > 0 && (
                    <span className="w-5 h-5 rounded-full bg-primary text-white text-xs flex items-center justify-center">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
                <button type="submit" disabled={loading} className="btn-primary whitespace-nowrap">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Searching...
                    </span>
                  ) : (
                    'Find Movies'
                  )}
                </button>
              </div>
            </form>

            {/* Expandable Filters Panel */}
            {showFilters && (
              <div className="mt-4 card p-5 animate-fade-in">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-main font-semibold">Advanced Filters</h3>
                  {activeFiltersCount > 0 && (
                    <button onClick={clearFilters} className="text-sm text-primary hover:underline">
                      Clear all
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Genre Filter */}
                  <div>
                    <label className="block text-sm text-muted mb-2">Genre</label>
                    <select
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-main 
                               focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="">All Genres</option>
                      {availableGenres.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>

                  {/* Year Filter */}
                  <div>
                    <label className="block text-sm text-muted mb-2">Year</label>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-main 
                               focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="">All Years</option>
                      {availableYears.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  {/* Min Rating Filter */}
                  <div>
                    <label className="block text-sm text-muted mb-2">Min Rating: {minRating}</label>
                    <input
                      type="range"
                      min="0"
                      max="9"
                      step="0.5"
                      value={minRating}
                      onChange={(e) => setMinRating(e.target.value)}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted mt-1">
                      <span>0</span>
                      <span>9+</span>
                    </div>
                  </div>

                  {/* Sort By */}
                  <div>
                    <label className="block text-sm text-muted mb-2">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-main 
                               focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="relevance">Relevance</option>
                      <option value="rating">Highest Rated</option>
                      <option value="votes">Most Votes</option>
                      <option value="year">Newest First</option>
                      <option value="gross">Box Office</option>
                    </select>
                  </div>
                </div>

                {/* Genre Pills */}
                <div className="mt-5 pt-4 border-t border-border">
                  <p className="text-sm text-muted mb-3">Popular genres:</p>
                  <div className="flex flex-wrap gap-2">
                    {popularGenres.map(g => (
                      <button
                        key={g}
                        onClick={() => setGenre(genre === g ? '' : g)}
                        className={`filter-pill ${genre === g ? 'active' : ''}`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Example Queries */}
            {!searched && (
              <div className="mt-5">
                <p className="text-sm text-muted mb-3">Try searching for:</p>
                <div className="flex flex-wrap gap-2">
                  {exampleQueries.map((example, index) => (
                    <button
                      key={index}
                      onClick={() => setQuery(example)}
                      className="filter-pill"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Results Section */}
        <section className="px-4 sm:px-6 lg:px-8 pb-20">
          <div className="max-w-7xl mx-auto">
            {/* Error Message */}
            {error && (
              <div className="text-center py-8">
                <div className="card inline-block px-6 py-4 text-red-500">
                  <p>{error}</p>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="loader mb-4"></div>
                <p className="text-muted">Finding movies...</p>
              </div>
            )}

            {/* Results */}
            {!loading && searched && movies.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-main">
                    {query ? `Results for "${query}"` : 'Movies'}
                  </h2>
                  <span className="text-muted text-sm">
                    Showing {movies.length} of {total.toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 stagger-children">
                  {movies.map((movie, index) => (
                    <MovieCard key={`${movie.title}-${index}`} movie={movie} />
                  ))}
                </div>
              </>
            )}

            {/* No Results */}
            {!loading && searched && movies.length === 0 && !error && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">🎬</div>
                <h3 className="text-xl font-semibold text-main mb-2">No movies found</h3>
                <p className="text-muted mb-4">Try adjusting your filters or search terms</p>
                <button onClick={clearFilters} className="text-primary hover:underline">
                  Clear all filters
                </button>
              </div>
            )}

            {/* Initial State */}
            {!searched && !loading && (
              <div className="text-center py-20">
                <div className="text-7xl mb-6 wiggle-on-hover">🍿</div>
                <h3 className="text-2xl font-semibold text-main mb-3">
                  Ready to discover great movies?
                </h3>
                <p className="text-muted max-w-md mx-auto">
                  Search by description, filter by genre or year, or use the quick filters above!
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {/* Brand Section */}
              <div className="md:col-span-2">
                <h3 className="text-2xl font-bold text-gradient mb-3">Mobay</h3>
                <p className="text-muted text-sm mb-4 max-w-md">
                  Your ultimate movie discovery companion. Find your next favorite film from our collection
                  of {totalMoviesCount.toLocaleString()}+ movies spanning over a century of cinema.
                </p>
                <div className="flex items-center gap-4">
                  <a href="#" className="text-muted hover:text-primary transition-colors" aria-label="Twitter">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                  <a href="#" className="text-muted hover:text-primary transition-colors" aria-label="GitHub">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                  </a>
                  <a href="#" className="text-muted hover:text-primary transition-colors" aria-label="Instagram">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Quick Links */}
              <div>
                <h4 className="font-semibold text-main mb-4">Explore</h4>
                <ul className="space-y-2 text-sm">
                  <li><button onClick={() => handleQuickFilter('topRated')} className="text-muted hover:text-primary transition-colors">Top Rated Movies</button></li>
                  <li><button onClick={() => handleQuickFilter('mostPopular')} className="text-muted hover:text-primary transition-colors">Most Popular</button></li>
                  <li><button onClick={() => handleQuickFilter('boxOffice')} className="text-muted hover:text-primary transition-colors">Box Office Hits</button></li>
                  <li><button onClick={() => handleQuickFilter('year', '2024')} className="text-muted hover:text-primary transition-colors">New Releases</button></li>
                </ul>
              </div>

              {/* Genres */}
              <div>
                <h4 className="font-semibold text-main mb-4">Popular Genres</h4>
                <ul className="space-y-2 text-sm">
                  <li><button onClick={() => handleQuickFilter('genre', 'Action')} className="text-muted hover:text-primary transition-colors">Action</button></li>
                  <li><button onClick={() => handleQuickFilter('genre', 'Comedy')} className="text-muted hover:text-primary transition-colors">Comedy</button></li>
                  <li><button onClick={() => handleQuickFilter('genre', 'Drama')} className="text-muted hover:text-primary transition-colors">Drama</button></li>
                  <li><button onClick={() => handleQuickFilter('genre', 'Horror')} className="text-muted hover:text-primary transition-colors">Horror</button></li>
                </ul>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="mt-10 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-muted text-sm">
                © {new Date().getFullYear()} Mobay. All rights reserved.
              </p>
              <div className="flex items-center gap-6 text-sm text-muted">
                <span>🎬 {totalMoviesCount.toLocaleString()}+ Movies</span>
                <span>📅 1920-2025</span>
                <span>⭐ IMDb Data</span>
              </div>
            </div>
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
      className="card p-4 block group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-semibold text-main group-hover:text-primary transition-colors line-clamp-2 flex-1 text-sm">
          {movie.title}
        </h3>
        {movie.rating && (
          <span className="rating-badge flex-shrink-0">
            ⭐ {movie.rating}
          </span>
        )}
      </div>

      {/* Meta Info */}
      <div className="flex items-center gap-2 text-xs text-muted mb-3 flex-wrap">
        <span>{movie.year}</span>
        {movie.duration && (
          <>
            <span className="w-1 h-1 rounded-full bg-border"></span>
            <span>{movie.duration}</span>
          </>
        )}
        {movie.mpa && (
          <span className="px-1.5 py-0.5 bg-border rounded text-xs">{movie.mpa}</span>
        )}
        {movie.votesNum > 0 && (
          <>
            <span className="w-1 h-1 rounded-full bg-border"></span>
            <span>{formatNumber(movie.votesNum)} votes</span>
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
      <p className="text-sm text-muted line-clamp-2 mb-3">
        {movie.description}
      </p>

      {/* Directors & Stars */}
      <div className="space-y-1 text-xs text-muted">
        {directors.length > 0 && (
          <p className="truncate">
            <span className="opacity-70">Directed by</span> {directors.join(', ')}
          </p>
        )}
        {stars.length > 0 && (
          <p className="truncate">
            <span className="opacity-70">Starring</span> {stars.join(', ')}
          </p>
        )}
      </div>

      {/* Box Office */}
      {movie.grossNum > 0 && (
        <div className="mt-3 pt-3 border-t border-border text-xs text-green-600 dark:text-green-400 font-medium">
          💰 {formatCurrency(movie.grossNum)} worldwide
        </div>
      )}

      {/* View Link */}
      <div className="mt-3 pt-3 border-t border-border">
        <span className="text-sm text-primary group-hover:underline flex items-center gap-1">
          View Details
          <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </span>
      </div>
    </a>
  );
}
