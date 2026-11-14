CREATE TABLE `market_quotes` (
	`market` text PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL
);
