-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capturedOn" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followers" INTEGER NOT NULL,
    "following" INTEGER,
    "tweetCount" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'api'
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountSnapshot_capturedOn_key" ON "AccountSnapshot"("capturedOn");
