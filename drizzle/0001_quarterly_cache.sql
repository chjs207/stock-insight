CREATE TABLE `quarterly_reports` (
	`corp_code` text NOT NULL,
	`year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`data` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`corp_code`, `year`, `quarter`)
);
