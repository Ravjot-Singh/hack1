-- A placement round can now use several rooms (big tests spread over halls and labs).

-- CreateTable
CREATE TABLE "PlacementVenue" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "bookingId" TEXT,

    CONSTRAINT "PlacementVenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlacementVenue_roundId_roomId_key" ON "PlacementVenue"("roundId", "roomId");

-- AddForeignKey
ALTER TABLE "PlacementVenue" ADD CONSTRAINT "PlacementVenue_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PlacementRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep each existing round's single room (and its booking), seating the booking's head-count.
INSERT INTO "PlacementVenue" ("id", "roundId", "roomId", "seats", "bookingId")
SELECT 'pv_' || r."id", r."id", r."roomId", COALESCE(b."attendees", 0), r."bookingId"
FROM "PlacementRound" r
LEFT JOIN "VenueBooking" b ON b."id" = r."bookingId"
WHERE r."roomId" IS NOT NULL;

-- AlterTable
ALTER TABLE "PlacementRound" DROP COLUMN "bookingId",
DROP COLUMN "roomId";
