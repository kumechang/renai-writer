-- CreateTable
CREATE TABLE "XPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "articleUrl" TEXT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "XPost_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "XPost_articleId_idx" ON "XPost"("articleId");
