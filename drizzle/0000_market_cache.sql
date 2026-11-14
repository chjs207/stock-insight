CREATE TABLE `annual_reports` (
	`corp_code` text NOT NULL,
	`year` integer NOT NULL,
	`data` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`corp_code`, `year`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`corp_code` text PRIMARY KEY NOT NULL,
	`stock_code` text NOT NULL,
	`search_name` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `corp_directory` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL
);
