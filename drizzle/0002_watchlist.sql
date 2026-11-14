CREATE TABLE `watchlist` (
	`corp_code` text PRIMARY KEY NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`corp_code`) REFERENCES `companies`(`corp_code`) ON UPDATE no action ON DELETE no action
);
