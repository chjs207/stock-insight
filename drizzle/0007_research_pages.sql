CREATE TABLE `research_pages` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `fetched_at` integer NOT NULL,
  `data` text NOT NULL
);
