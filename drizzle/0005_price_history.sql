CREATE TABLE `price_history` (
	`stock_code` text PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL
);
