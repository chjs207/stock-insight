CREATE TABLE `asset_managers` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ownership_details` (
	`corp_code` text PRIMARY KEY NOT NULL,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ownership_months` (
	`month` text PRIMARY KEY NOT NULL,
	`searched_through` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`data` text NOT NULL
);
