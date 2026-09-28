'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import type { Title, TitleType } from '@/lib/types';
import TiltCard from './components/TiltCard';

// three.js only runs in the browser, and the page shouldn't wait for it to load
const Backdrop = dynamic(() => import('./components/Backdrop'), { ssr: false });

interface SearchResponse {
  results: Title[];
  total: number;
  query: string;
}

interface FiltersResponse {
  genres: string[];
  years: string[];
  totalMovies: number;
  typeCounts?: Record<TitleType, number>;
  mpaRatings: string[];
}

interface SearchState {
  query: string;
  type: '' | TitleType;
  genre: string;
  year: string;
  minRating: string;
  sortBy: string;
}

const EMPTY_SEARCH: SearchState = { query: '', type: '', genre: '', year: '', minRating: '0', sortBy: 'relevance' };

const TYPE_TABS: { value: '' | TitleType; label: string; icon: string }[] = [
  { value: '', label: 'All', icon: '✨' },
  { value: 'movie', label: 'Movies', icon: '🎬' },
  { value: 'series', label: 'Series', icon: '📺' },
  { value: 'anime', label: 'Anime', icon: '🌸' },
];

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
  const [movies, setMovies] = useState<Title[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  // Filter states
  const [showFilters, setShowFilters] = useState(false);
  const [type, setType] = useState<'' | TitleType>('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [minRating, setMinRating] = useState('0');
  const [sortBy, setSortBy] = useState('relevance');

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Bumped after each search so the 3D backdrop can react
  const [pulse, setPulse] = useState(0);
  // Only the latest search may update the results, even if an older one finishes later
  const latestRequest = useRef(0);

  // Available filter options
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [totalMoviesCount, setTotalMoviesCount] = useState(0);
  const [typeCounts, setTypeCounts] = useState<Record<TitleType, number>>({ movie: 0, series: 0, anime: 0 });

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
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
        if (data.typeCounts) setTypeCounts(data.typeCounts);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    loadFilters();
  }, []);

  // Runs a search with the current filters, replacing any given in `overrides`.
  // Taking overrides (rather than reading state set just before) avoids searching
  // with stale values, since state updates only apply on the next render.
  const runSearch = async (overrides: Partial<SearchState> = {}) => {
    const next: SearchState = { query, type, genre, year, minRating, sortBy, ...overrides };
    setQuery(next.query);
    setType(next.type);
    setGenre(next.genre);
    setYear(next.year);
    setMinRating(next.minRating);
    setSortBy(next.sortBy);

    const params = new URLSearchParams();
    if (next.query.trim()) params.set('query', next.query.trim());
    if (next.type) params.set('type', next.type);
    if (next.genre) params.set('genre', next.genre);
    if (next.year) params.set('year', next.year);
    if (next.minRating !== '0') params.set('minRating', next.minRating);
    if (next.sortBy !== 'relevance') params.set('sortBy', next.sortBy);
    params.set('limit', '24');

    const requestId = ++latestRequest.current;
    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const response = await fetch(`/api/recommend?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
      }
      const data: SearchResponse = await response.json();
      if (requestId !== latestRequest.current) return;
      setMovies(data.results);
      setTotal(data.total);
      setPulse(p => p + 1);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setMovies([]);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  };

  const handleSearch = (e?: FormEvent) => {
    if (e) e.preventDefault();

    if (!query.trim() && !type && !genre && !year && minRating === '0') {
      setError('Please enter a search term or select a filter');
      return;
    }
    runSearch();
  };

  // Quick filters start a fresh search, but stay within the selected tab
  const handleQuickFilter = (filterType: string, value = '') => {
    const fresh = { ...EMPTY_SEARCH, type };
    switch (filterType) {
      case 'topRated':
        return runSearch({ ...fresh, sortBy: 'rating', minRating: '7' });
      case 'mostPopular':
        return runSearch({ ...fresh, sortBy: 'votes' });
      case 'boxOffice':
        return runSearch({ ...fresh, sortBy: 'gross' });
      // Without a query, relevance already lists the best rated first, and it
      // keeps ranking by relevance if a search term is added afterwards
      case 'year':
        return runSearch({ ...fresh, year: value });
      case 'genre':
        return runSearch({ ...fresh, genre: value });
    }
  };

  // Switching tabs re-runs the current search; before any search it shows the best of that type
  const handleTypeChange = (newType: '' | TitleType) => {
    if (searched) runSearch({ type: newType });
    else runSearch({ ...EMPTY_SEARCH, type: newType });
  };

  const clearFilters = () => {
    latestRequest.current++;
    setType('');
    setGenre('');
    setYear('');
    setMinRating('0');
    setSortBy('relevance');
    setQuery('');
    setSearched(false);
    setLoading(false);
    setMovies([]);
  };

  const activeFiltersCount = [genre, year, minRating !== '0', sortBy !== 'relevance'].filter(Boolean).length;
  const typeLabel = TYPE_TABS.find(t => t.value === type)?.label ?? 'All';

  const exampleQueries = [
    "mind-bending sci-fi thriller",
    "heartwarming family adventure",
    "intense action great villain",
    "romantic comedy",
  ];

  const popularGenres = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'Thriller', 'Animation'];
  // availableYears is sorted newest first
  const recentYears = availableYears.length > 0 ? availableYears.slice(0, 5) : ['2025', '2024', '2023', '2022', '2021'];
  const yearSpan = availableYears.length > 0 ? `${availableYears[availableYears.length - 1]}–${availableYears[0]}` : '';

  return (
    <div className="page-container">
      <Backdrop theme={theme} pulse={pulse} />
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
              <p className="text-lg text-muted max-w-xl mx-auto legible">
                Discover your next favorite movie, series or anime from {totalMoviesCount.toLocaleString()}+ titles
              </p>
            </div>
          </div>
        </header>

        {/* Quick Filters Bar */}
        <section className="px-4 sm:px-6 lg:px-8 pb-6">
          <div className="max-w-7xl mx-auto">
            {/* Type Tabs */}
            <div className="flex justify-center mb-5">
              <div className="type-tabs" role="tablist" aria-label="Type of title">
                {/* Hide tabs with nothing in them, e.g. Series before `npm run update-data` has run */}
                {TYPE_TABS.filter(tab => !tab.value || totalMoviesCount === 0 || typeCounts[tab.value] > 0).map(tab => {
                  const count = tab.value ? typeCounts[tab.value] : totalMoviesCount;
                  return (
                    <button
                      key={tab.label}
                      role="tab"
                      aria-selected={type === tab.value}
                      onClick={() => handleTypeChange(tab.value)}
                      className={`type-tab ${type === tab.value ? 'active' : ''}`}
                    >
                      <span className="type-tab-icon" aria-hidden="true">{tab.icon}</span> {tab.label}
                      {count > 0 && <span className="type-tab-count hidden sm:inline">{formatNumber(count)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

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
              <span className="text-muted text-sm mr-1 legible">Browse by year:</span>
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
                {/* Not disabled while loading: a disabled button also blocks submitting with Enter,
                    and a new search safely replaces one that's still running */}
                <button type="submit" className="btn-primary whitespace-nowrap">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Searching...
                    </span>
                  ) : (
                    'Search'
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
                <p className="text-sm text-muted mb-3 legible">Try searching for:</p>
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
                  <h2 className="text-xl font-semibold text-main legible">
                    {query ? `Results for "${query}"` : type ? typeLabel : 'Movies, series & anime'}
                  </h2>
                  <span className="text-muted text-sm legible">
                    Showing {movies.length} of {total.toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 stagger-children">
                  {movies.map(movie => (
                    // The wrapper runs the fade-in, so its transform doesn't fight the card's tilt
                    <div key={movie.id}>
                      <TitleCard title={movie} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* No Results */}
            {!loading && searched && movies.length === 0 && !error && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">🎬</div>
                <h3 className="text-xl font-semibold text-main mb-2">Nothing found</h3>
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
                  Search by title, person or plot, pick Movies, Series or Anime, or use the quick filters above!
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
                  Your ultimate movie discovery companion. Find your next favorite film, series or anime from our
                  collection of {totalMoviesCount.toLocaleString()}+ titles spanning over a century of screen stories.
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
                  <li><button onClick={() => handleQuickFilter('year', recentYears[0])} className="text-muted hover:text-primary transition-colors">New Releases</button></li>
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
                <span>🎬 {totalMoviesCount.toLocaleString()}+ Titles</span>
                {yearSpan && <span>📅 {yearSpan}</span>}
                <span>⭐ IMDb · TMDB · AniList</span>
              </div>
            </div>
            <p className="mt-6 text-xs text-muted">
              Movie data from IMDb and TMDB, anime data from AniList. This product uses the TMDB API but is not
              endorsed or certified by TMDB.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

// Where the "View on ..." link goes, for its label
function linkSource(link: string): string {
  if (link.includes('imdb.com')) return 'IMDb';
  if (link.includes('anilist.co')) return 'AniList';
  if (link.includes('themoviedb.org')) return 'TMDB';
  return 'details';
}

const TYPE_BADGES: Record<TitleType, { label: string; className: string }> = {
  movie: { label: 'Movie', className: 'type-badge movie' },
  series: { label: 'Series', className: 'type-badge series' },
  anime: { label: 'Anime', className: 'type-badge anime' },
};

// Same colours for the same title every time
function placeholderHue(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function Poster({ title }: { title: Title }) {
  const [failed, setFailed] = useState(false);

  if (title.poster && !failed) {
    return (
      <div className="poster">
        {/* Posters come straight from TMDB/AniList's image CDNs, so skip Next's optimizer */}
        <Image
          src={title.poster}
          alt={`${title.title} poster`}
          fill
          sizes="112px"
          className="object-cover"
          unoptimized
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  const hue = placeholderHue(title.title);
  // "The Godfather" -> "G"
  const initial = title.title.replace(/^(the|a|an)\s+/i, '').charAt(0);
  return (
    <div
      className="poster poster-placeholder"
      style={{ background: `linear-gradient(145deg, hsl(${hue} 70% 55%), hsl(${(hue + 60) % 360} 70% 35%))` }}
      aria-hidden="true"
    >
      <span>{initial}</span>
    </div>
  );
}

function TitleCard({ title }: { title: Title }) {
  const badge = TYPE_BADGES[title.type];
  const creditLabel = title.type === 'series' ? 'Created by' : 'Directed by';
  const directors = title.directors.slice(0, 3);
  const stars = title.stars.slice(0, 3);
  const studios = (title.studios ?? []).slice(0, 2);
  // AniList counts members who added the anime to a list, not votes
  const votesLabel = title.id.startsWith('anilist-') ? 'fans' : 'votes';
  const episodeInfo = [
    title.seasons ? `${title.seasons} season${title.seasons === 1 ? '' : 's'}` : '',
    title.episodes ? `${title.episodes} episode${title.episodes === 1 ? '' : 's'}` : '',
    title.status ?? '',
  ].filter(Boolean);

  return (
    <TiltCard href={title.link} className="card flex h-full group">
      <Poster title={title} />

      <div className="p-4 flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-main group-hover:text-primary transition-colors line-clamp-2 flex-1 text-sm">
            {title.title}
          </h3>
          {title.rating !== null && (
            <span className="rating-badge flex-shrink-0">
              ⭐ {title.rating.toFixed(1)}
            </span>
          )}
        </div>

        {/* Meta Info */}
        <div className="flex items-center gap-2 text-xs text-muted mb-2 flex-wrap">
          <span className={badge.className}>
            {badge.label}{title.format && title.format !== 'Movie' ? ` · ${title.format}` : ''}
          </span>
          <span>{title.year}</span>
          {title.duration && (
            <>
              <span className="w-1 h-1 rounded-full bg-border"></span>
              <span>{title.duration}</span>
            </>
          )}
          {title.mpa && (
            <span className="px-1.5 py-0.5 bg-border rounded text-xs">{title.mpa}</span>
          )}
          {title.votes > 0 && (
            <>
              <span className="w-1 h-1 rounded-full bg-border"></span>
              <span>{formatNumber(title.votes)} {votesLabel}</span>
            </>
          )}
        </div>

        {/* Seasons, episodes and status for series and anime */}
        {episodeInfo.length > 0 && (
          <p className="text-xs text-muted mb-2">{episodeInfo.join(' · ')}</p>
        )}

        {/* Genres */}
        {title.genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {title.genres.slice(0, 3).map(genre => (
              <span key={genre} className="genre-tag">
                {genre}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        <p className="text-sm text-muted line-clamp-3 mb-3">
          {title.description}
        </p>

        {/* Credits */}
        <div className="space-y-1 text-xs text-muted mt-auto">
          {directors.length > 0 && (
            <p className="truncate">
              <span className="opacity-70">{creditLabel}</span> {directors.join(', ')}
            </p>
          )}
          {stars.length > 0 && (
            <p className="truncate">
              <span className="opacity-70">Starring</span> {stars.join(', ')}
            </p>
          )}
          {studios.length > 0 && (
            <p className="truncate">
              <span className="opacity-70">{title.type === 'series' ? 'On' : 'Studio'}</span> {studios.join(', ')}
            </p>
          )}
        </div>

        {/* Box Office */}
        {title.grossWorldwide > 0 && (
          <div className="mt-3 pt-3 border-t border-border text-xs text-green-600 dark:text-green-400 font-medium">
            💰 {formatCurrency(title.grossWorldwide)} worldwide
          </div>
        )}

        {/* View Link */}
        <div className="mt-3 pt-3 border-t border-border">
          <span className="text-sm text-primary group-hover:underline flex items-center gap-1">
            View on {linkSource(title.link)}
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </span>
        </div>
      </div>
    </TiltCard>
  );
}
