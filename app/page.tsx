'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { Title, TitleType } from '@/lib/types';

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
  limit: number;
}

const PAGE_SIZE = 24;
// Titles in the first row of the widest grid; their posters load without waiting to scroll into view
const FIRST_ROW = 6;
// The API returns at most 100 results per request
const MAX_RESULTS = 96;

const EMPTY_SEARCH: SearchState = {
  query: '',
  type: '',
  genre: '',
  year: '',
  minRating: '0',
  sortBy: 'relevance',
  limit: PAGE_SIZE,
};

const TYPE_TABS: { value: '' | TitleType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
  { value: 'anime', label: 'Anime' },
];

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Top picks' },
  { value: 'rating', label: 'Top rated' },
  { value: 'votes', label: 'Most popular' },
  { value: 'year', label: 'Newest' },
  { value: 'gross', label: 'Box office' },
];

const POPULAR_GENRES = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'Thriller', 'Animation'];

// Format large numbers (e.g. 3000000 -> "3.0M")
function formatNumber(num: number): string {
  if (num >= 1000000000) return `${(num / 1000000000).toFixed(1)}B`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// A heading for the results, e.g. "Top rated · Horror · Movies"
function describeSearch(search: SearchState): string {
  const query = search.query.trim();
  if (query) return `Results for “${query}”`;
  const parts = [SORT_OPTIONS.find(o => o.value === search.sortBy)?.label ?? 'Top picks'];
  if (search.genre) parts.push(search.genre);
  if (search.year) parts.push(search.year);
  if (search.type) parts.push(TYPE_TABS.find(t => t.value === search.type)!.label);
  return parts.join(' · ');
}

// Whether `search` is exactly what a quick link would run, so the link can show as selected
function matchesQuickLink(search: SearchState, overrides: Partial<SearchState>): boolean {
  const expected = { ...EMPTY_SEARCH, ...overrides };
  return (['query', 'genre', 'year', 'minRating', 'sortBy'] as const).every(key => search[key] === expected[key]);
}

export default function Home() {
  // Filters as currently set in the search box and filter panel
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'' | TitleType>('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [minRating, setMinRating] = useState('0');
  const [sortBy, setSortBy] = useState('relevance');
  // The search whose results are on screen
  const [shown, setShown] = useState<SearchState>(EMPTY_SEARCH);

  const [titles, setTitles] = useState<Title[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  // Bumped on each new search (not "Show more") so the grid fades in again
  const [resultsKey, setResultsKey] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  // Only the latest search may update the results, even if an older one finishes later
  const latestRequest = useRef(0);

  // Available filter options
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [totalTitles, setTotalTitles] = useState(0);
  const [typeCounts, setTypeCounts] = useState<Record<TitleType, number>>({ movie: 0, series: 0, anime: 0 });

  // Runs a search with the current filters, replacing any given in `overrides`.
  // Taking overrides (rather than reading state set just before) avoids searching
  // with stale values, since state updates only apply on the next render.
  // `append` keeps the current results on screen while more are loading.
  const runSearch = async (overrides: Partial<SearchState> = {}, append = false) => {
    const next: SearchState = { query, type, genre, year, minRating, sortBy, limit: PAGE_SIZE, ...overrides };
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
    params.set('limit', String(next.limit));

    const requestId = ++latestRequest.current;
    setError('');
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const response = await fetch(`/api/recommend?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load titles');
      const data: SearchResponse = await response.json();
      if (requestId !== latestRequest.current) return;
      setTitles(data.results);
      setTotal(data.total);
      setShown(next);
      if (!append) setResultsKey(k => k + 1);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setTitles([]);
      setTotal(0);
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // Load filter options and the opening list of top picks
  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');

    async function loadFilters() {
      try {
        const response = await fetch('/api/recommend?getFilters=true');
        const data: FiltersResponse = await response.json();
        setAvailableGenres(data.genres || []);
        setAvailableYears(data.years || []);
        setTotalTitles(data.totalMovies || 0);
        if (data.typeCounts) setTypeCounts(data.typeCounts);
      } catch (err) {
        console.error('Failed to load filters:', err);
      }
    }
    loadFilters();
    runSearch(EMPTY_SEARCH);
    // Runs once on mount; runSearch reads the latest state each time it's called
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    try {
      localStorage.setItem('theme', newTheme);
    } catch {
      // Storage can be blocked; the theme still changes for this visit
    }
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  // Quick links start a fresh search, but stay within the selected tab
  const runQuickLink = (overrides: Partial<SearchState>) => {
    runSearch({ ...EMPTY_SEARCH, type: shown.type, ...overrides });
  };

  // Switching tabs re-runs the search on screen for the new type
  const handleTypeChange = (newType: '' | TitleType) => {
    runSearch({ ...shown, type: newType, limit: PAGE_SIZE });
  };

  const showMore = () => {
    runSearch({ ...shown, limit: shown.limit + PAGE_SIZE }, true);
  };

  const goHome = () => {
    setShowFilters(false);
    runSearch(EMPTY_SEARCH);
  };

  const activeFiltersCount = [shown.genre, shown.year, shown.minRating !== '0', shown.sortBy !== 'relevance'].filter(Boolean).length;

  // availableYears is sorted newest first
  const latestYear = availableYears[0] ?? '';
  const yearSpan = availableYears.length > 0 ? `${availableYears[availableYears.length - 1]}–${latestYear}` : '';

  const quickLinks: { label: string; search: Partial<SearchState> }[] = [
    { label: 'Top rated', search: { sortBy: 'rating', minRating: '7' } },
    { label: 'Most popular', search: { sortBy: 'votes' } },
    { label: 'Box office', search: { sortBy: 'gross' } },
    ...(latestYear ? [{ label: 'New releases', search: { year: latestYear } }] : []),
  ];

  // Hide tabs with nothing in them, e.g. Series before `npm run update-data` has run
  const tabs = TYPE_TABS.filter(tab => !tab.value || totalTitles === 0 || typeCounts[tab.value] > 0);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="site-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-x-8 gap-y-2">
          <button type="button" onClick={goHome} className="wordmark">
            Mobay
          </button>

          <nav aria-label="Browse" className="order-last w-full md:order-none md:w-auto flex gap-6 overflow-x-auto no-scrollbar">
            {tabs.map(tab => (
              <button
                key={tab.label}
                type="button"
                onClick={() => handleTypeChange(tab.value)}
                aria-current={shown.type === tab.value ? 'page' : undefined}
                className={`nav-tab ${shown.type === tab.value ? 'active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <form onSubmit={handleSearch} role="search" className="flex-1 min-w-0 md:max-w-md md:ml-auto">
            <label htmlFor="search" className="sr-only">
              Search
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id="search"
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search titles, people or plots"
                className="search-input"
                autoComplete="off"
              />
            </div>
          </form>

          <button onClick={toggleTheme} className="icon-button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Quick links and genres */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar">
            {quickLinks.map(link => {
              const active = matchesQuickLink(shown, link.search);
              return (
                <button
                  key={link.label}
                  type="button"
                  onClick={() => runQuickLink(link.search)}
                  aria-pressed={active}
                  className={`chip ${active ? 'active' : ''}`}
                >
                  {link.label}
                </button>
              );
            })}
            <span className="chip-divider" aria-hidden="true" />
            {POPULAR_GENRES.map(g => {
              const active = matchesQuickLink(shown, { genre: g });
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => runQuickLink({ genre: g })}
                  aria-pressed={active}
                  className={`chip ${active ? 'active' : ''}`}
                >
                  {g}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            className={`chip flex-shrink-0 ${showFilters ? 'selected' : ''}`}
          >
            Filters{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
          </button>
        </div>

        {showFilters && (
          <form
            className="panel mb-8"
            onSubmit={e => {
              e.preventDefault();
              runSearch();
            }}
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <label className="field">
                <span>Genre</span>
                <select value={genre} onChange={e => setGenre(e.target.value)}>
                  <option value="">Any genre</option>
                  {availableGenres.map(g => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Year</span>
                <select value={year} onChange={e => setYear(e.target.value)}>
                  <option value="">Any year</option>
                  {availableYears.map(y => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Rating</span>
                <select value={minRating} onChange={e => setMinRating(e.target.value)}>
                  <option value="0">Any rating</option>
                  {['6', '7', '8', '9'].map(r => (
                    <option key={r} value={r}>
                      {r}+
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Sort by</span>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => runSearch({ ...EMPTY_SEARCH, query, type })} className="btn-ghost">
                Reset
              </button>
              <button type="submit" className="btn">
                Apply
              </button>
            </div>
          </form>
        )}

        <div className="flex items-baseline justify-between gap-4 mb-5">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-main truncate">{describeSearch(shown)}</h1>
          {!loading && total > 0 && (
            <span className="text-sm text-muted flex-shrink-0">{total.toLocaleString()} titles</span>
          )}
        </div>

        {error ? (
          <div className="py-24 text-center">
            <p className="text-main font-medium mb-2">{error}</p>
            <button type="button" onClick={() => runSearch(shown)} className="btn-ghost">
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="title-grid" aria-busy="true" aria-label="Loading titles">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i}>
                <div className="skeleton aspect-[2/3]" />
                <div className="skeleton h-3.5 mt-3 w-4/5" />
                <div className="skeleton h-3 mt-2 w-1/2" />
              </div>
            ))}
          </div>
        ) : titles.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-main font-medium mb-1">No titles found</p>
            <p className="text-muted text-sm mb-5">Try a different search or fewer filters.</p>
            <button type="button" onClick={goHome} className="btn-ghost">
              Back to top picks
            </button>
          </div>
        ) : (
          <>
            <div key={resultsKey} className="title-grid fade-in">
              {titles.map((title, i) => (
                <TitleCard key={title.id} title={title} showType={!shown.type} priority={i < FIRST_ROW} />
              ))}
            </div>
            {titles.length < total && shown.limit < MAX_RESULTS && (
              <div className="mt-12 text-center">
                <button type="button" onClick={showMore} disabled={loadingMore} className="btn-ghost">
                  {loadingMore ? 'Loading…' : 'Show more'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row sm:justify-between gap-4 text-sm text-muted">
          <div>
            <p className="font-semibold text-main mb-1">Mobay</p>
            {totalTitles > 0 && (
              <p>
                {totalTitles.toLocaleString()} movies, series and anime{yearSpan ? `, ${yearSpan}` : ''}.
              </p>
            )}
          </div>
          <p className="sm:max-w-sm sm:text-right">
            Data from IMDb, TMDB and AniList. This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
      </footer>
    </div>
  );
}

const TYPE_LABELS: Record<TitleType, string> = { movie: 'Movie', series: 'Series', anime: 'Anime' };

// TMDB serves every poster at several widths. The data stores w342, so offer w185 too
// (a third of the bytes) and let the browser pick by card width and screen density.
function posterSrcSet(url: string): string | undefined {
  const match = url.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w342(\/.+)$/);
  return match ? `${match[1]}w185${match[2]} 185w, ${url} 342w` : undefined;
}

// Card width at each grid breakpoint (see .title-grid), so the browser can choose a size
const POSTER_SIZES = '(min-width: 1280px) 185px, (min-width: 1024px) 18vw, (min-width: 768px) 22vw, (min-width: 640px) 29vw, 47vw';

// `priority` is for posters that are on screen at first, which shouldn't wait to be lazy-loaded
function Poster({ title, priority }: { title: Title; priority: boolean }) {
  const [failed, setFailed] = useState(false);

  if (title.poster && !failed) {
    const srcSet = posterSrcSet(title.poster);
    return (
      // A plain img: the posters come straight from TMDB/AniList's image CDNs, and next/image
      // can't pick between the CDN's own sizes
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={title.poster}
        srcSet={srcSet}
        sizes={srcSet ? POSTER_SIZES : undefined}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="poster-placeholder" aria-hidden="true">
      <span className="poster-placeholder-title">{title.title}</span>
      <span className="poster-placeholder-year">{title.year}</span>
    </div>
  );
}

function TitleCard({ title, showType, priority }: { title: Title; showType: boolean; priority: boolean }) {
  // Length for movies; seasons, episodes or format for series and anime
  let detail = '';
  if (title.type === 'movie') detail = title.duration;
  else if (title.seasons) detail = `${title.seasons} season${title.seasons === 1 ? '' : 's'}`;
  else if (title.episodes && title.episodes > 1) detail = `${title.episodes} episodes`;
  else if (title.format) detail = title.format;

  const meta = [title.year, showType && title.type !== 'movie' ? TYPE_LABELS[title.type] : '', detail].filter(Boolean);
  const credits = title.directors.length > 0 ? title.directors : (title.studios ?? []);
  // AniList counts members who added the anime to a list, not votes
  const votesLabel = title.id.startsWith('anilist-') ? 'fans' : 'votes';

  return (
    <a href={title.link || undefined} target="_blank" rel="noopener noreferrer" className="title-card">
      <div className="title-poster">
        <Poster title={title} priority={priority} />
        {(title.description || title.genres.length > 0) && (
          <div className="title-overlay" aria-hidden="true">
            {title.genres.length > 0 && <p className="overlay-genres">{title.genres.slice(0, 3).join(' · ')}</p>}
            {title.description && <p className="overlay-description">{title.description}</p>}
            {credits.length > 0 && <p className="overlay-credits">{credits.slice(0, 2).join(', ')}</p>}
            {title.votes > 0 && (
              <p className="overlay-credits">
                {formatNumber(title.votes)} {votesLabel}
              </p>
            )}
          </div>
        )}
      </div>
      <h3 className="title-name">{title.title}</h3>
      <p className="title-meta">
        {title.rating !== null && (
          <span className="title-rating">
            <span aria-hidden="true">★</span> {title.rating.toFixed(1)}
          </span>
        )}
        <span className="truncate">{meta.join(' · ')}</span>
      </p>
    </a>
  );
}
