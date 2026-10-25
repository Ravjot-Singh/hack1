-- CreateTable
CREATE TABLE "ElectiveWindow" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "opensOn" DATE NOT NULL,
    "closesOn" DATE NOT NULL,
    "seats" JSONB NOT NULL DEFAULT '{}',
    "appliedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectiveWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ElectiveChoice" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ElectiveChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ElectiveWindow_basketId_key" ON "ElectiveWindow"("basketId");

-- CreateIndex
CREATE INDEX "ElectiveChoice_basketId_offeringId_idx" ON "ElectiveChoice"("basketId", "offeringId");

-- CreateIndex
CREATE UNIQUE INDEX "ElectiveChoice_basketId_studentId_key" ON "ElectiveChoice"("basketId", "studentId");

-- AddForeignKey
ALTER TABLE "ElectiveWindow" ADD CONSTRAINT "ElectiveWindow_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveWindow" ADD CONSTRAINT "ElectiveWindow_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "ElectiveBasket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveChoice" ADD CONSTRAINT "ElectiveChoice_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ElectiveChoice" ADD CONSTRAINT "ElectiveChoice_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "ElectiveBasket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
