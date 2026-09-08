-- CreateTable
CREATE TABLE "WatchedAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "note" TEXT,
    "xUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WatchedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchedAccountId" TEXT NOT NULL,
    "tweetId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "postedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedPost_watchedAccountId_fkey" FOREIGN KEY ("watchedAccountId") REFERENCES "WatchedAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EngagementReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchedPostId" TEXT NOT NULL,
    "generatedText" TEXT NOT NULL,
    "finalText" TEXT NOT NULL,
    "selfCheckJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "githubIssueOwner" TEXT,
    "githubIssueRepo" TEXT,
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "approvedBy" TEXT,
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "tweetId" TEXT,
    "tweetUrl" TEXT,
    "failureReason" TEXT,
    "feedbackNotes" TEXT,
    "feedbackBy" TEXT,
    "feedbackAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EngagementReply_watchedPostId_fkey" FOREIGN KEY ("watchedPostId") REFERENCES "WatchedPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchedAccount_username_key" ON "WatchedAccount"("username");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedPost_tweetId_key" ON "WatchedPost"("tweetId");

-- CreateIndex
CREATE INDEX "WatchedPost_watchedAccountId_idx" ON "WatchedPost"("watchedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementReply_watchedPostId_key" ON "EngagementReply"("watchedPostId");
