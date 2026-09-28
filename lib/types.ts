// Shared between the API route and the page, so it must not import server-only modules

export type TitleType = 'movie' | 'series' | 'anime';

export interface Title {
    // IMDb id ("tt0468569") when known, otherwise "tmdb-tv-1396", "anilist-16498", ...
    id: string;
    type: TitleType;
    // For anime and series: "Movie", "TV", "OVA", ...
    format?: string;
    title: string;
    // Other name to search by, e.g. the romaji title of an anime shown in English
    altTitle?: string;
    year: string;
    duration: string;
    mpa: string;
    // 0-10, or null when unrated
    rating: number | null;
    // IMDb or TMDB vote count, or AniList popularity for anime
    votes: number;
    description: string;
    link: string;
    // Directors for movies, creators for series
    directors: string[];
    stars: string[];
    // Networks for series, animation studios for anime
    studios?: string[];
    genres: string[];
    languages: string[];
    releaseDate: string;
    grossWorldwide: number;
    // Full poster image URL, or empty when there is none
    poster: string;
    seasons?: number;
    episodes?: number;
    status?: string;
}
