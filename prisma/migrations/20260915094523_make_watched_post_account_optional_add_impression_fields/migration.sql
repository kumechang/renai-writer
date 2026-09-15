-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WatchedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchedAccountId" TEXT,
    "tweetId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "postedAt" DATETIME NOT NULL,
    "authorId" TEXT,
    "impressionCount" INTEGER,
    "postUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "githubIssueOwner" TEXT,
    "githubIssueRepo" TEXT,
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "reviewCommentPostedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedPost_watchedAccountId_fkey" FOREIGN KEY ("watchedAccountId") REFERENCES "WatchedAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WatchedPost" ("createdAt", "githubIssueNumber", "githubIssueOwner", "githubIssueRepo", "githubIssueUrl", "id", "postedAt", "reviewCommentPostedAt", "status", "text", "tweetId", "watchedAccountId") SELECT "createdAt", "githubIssueNumber", "githubIssueOwner", "githubIssueRepo", "githubIssueUrl", "id", "postedAt", "reviewCommentPostedAt", "status", "text", "tweetId", "watchedAccountId" FROM "WatchedPost";
DROP TABLE "WatchedPost";
ALTER TABLE "new_WatchedPost" RENAME TO "WatchedPost";
CREATE UNIQUE INDEX "WatchedPost_tweetId_key" ON "WatchedPost"("tweetId");
CREATE INDEX "WatchedPost_watchedAccountId_idx" ON "WatchedPost"("watchedAccountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
