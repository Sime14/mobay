# Mobay

Search movies, TV series and anime by title, person, genre or plot. Built with Next.js, with an animated three.js backdrop.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data

The `/api/recommend` route combines the following sources:

| Source | Location | Contents |
| --- | --- | --- |
| IMDb scrape | `Data/<year>/merged_movies_data_<year>.csv` | About 60,000 movies from 1920 to early 2025. Only the `merged_*` files are read. |
| [TMDB](https://www.themoviedb.org/) | `Data/tmdb/movies.json`, `Data/tmdb/series.json` | Movies and TV series with posters, cast and crew |
| [AniList](https://anilist.co/) | `Data/anilist/anime.json` | Anime series with posters, studios and scores |

The JSON files are optional; the app works with the CSVs alone.

TMDB movies that are already in the CSVs, matched by IMDb id, are merged rather than duplicated. The merge adds the poster and keeps IMDb's rating and vote count.

Japanese animation is listed under **Anime**. Anime films come from the CSVs and TMDB. Anime series come from AniList, so TMDB's copies of them are skipped.

### Refreshing the data

```bash
TMDB_API_KEY=<your key> npm run update-data
```

- Get a free TMDB key at <https://www.themoviedb.org/settings/api>. Either the "API Key" or the "API Read Access Token" works.
- AniList needs no key. Refresh only anime with `npm run update-data -- --only=anime`.
- By default the script fetches:
  - the 100 most-voted movies of every year since 1920
  - the 1,000 most-voted series, plus what's popular this year
  - the 3,000 most popular anime
- A full run makes about 12,000 TMDB requests and 60 AniList requests, so expect it to take several minutes.
- See the top of `scripts/update-data.mjs` for options, such as `--from-year=2024` for recent movies only.
- Each catalog is written only once it has downloaded completely, so a failed run keeps the previous files.
- Behind an HTTP proxy, add `NODE_USE_ENV_PROXY=1` (Node 22.21 or later), because Node's built-in `fetch` ignores `HTTPS_PROXY` otherwise.

After refreshing, commit the files in `Data/tmdb/` and `Data/anilist/` so the deployed site serves them.

This product uses the TMDB API but is not endorsed or certified by TMDB.
