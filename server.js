
import "dotenv/config";
import express from "express";
import { configure, checkPNRStatus, getAvailability } from "railkit";

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.RAILKIT_API_KEY;

if (!API_KEY) {
  throw new Error("Missing RAILKIT_API_KEY in .env");
}

configure(API_KEY);
app.use(express.json());

function formatJourneyDate(dateString) {
  // Example: "Oct 15, 2026 10:55:00 PM"
  const match = dateString?.match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/
  );

  if (!match) {
    throw new Error("Invalid journey date in PNR response");
  }

  const [, monthName, day, year] = match;
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const month = months[monthName.toLowerCase()];

  if (!month) {
    throw new Error("Unknown journey month");
  }

  return `${day.padStart(2, "0")}-${month}-${year}`;
}

app.get("/health", (_req, res) => {
  res.json({ success: true, message: "RailKit API is running" });
});

app.get("/pnr/:pnr/availability", async (req, res) => {
  const { pnr } = req.params;

  if (!/^\d{10}$/.test(pnr)) {
    return res.status(400).json({
      success: false,
      error: "PNR must be exactly 10 digits",
    });
  }

  try {
    // 1. Fetch PNR details.
    const pnrResult = await checkPNRStatus(pnr);

    if (!pnrResult?.success || !pnrResult.data) {
      return res.status(502).json({
        success: false,
        step: "pnr",
        error: pnrResult?.error || "PNR request failed",
      });
    }

    const data = pnrResult.data;
    const journey = data.journey;

    // 2. Extract the journey details.
    const trainNumber = String(data.train?.number || "");
    const from = journey?.source?.code;
    const to = journey?.destination?.code;
    const travelDate = formatJourneyDate(journey?.dateOfJourney);
    const travelClass = journey?.class;
    const quota = journey?.quota;

    if (!trainNumber || !from || !to || !travelClass || !quota) {
      return res.status(502).json({
        success: false,
        step: "pnr",
        error: "PNR response is missing required journey details",
      });
    }

    // 3. Fetch seat availability through the official SDK.
    const availabilityResult = await getAvailability(
      trainNumber,
      from,
      to,
      travelDate,
      travelClass,
      quota
    );

    if (!availabilityResult?.success || !availabilityResult.data) {
      return res.status(502).json({
        success: false,
        step: "availability",
        pnr_details: data,
        error: availabilityResult?.error || "Availability request failed",
      });
    }

    // 4. Return both results.
    return res.json({
      success: true,
      pnr_details: data,
      seat_availability: availabilityResult.data,
    });
  } catch (error) {
    console.error("RailKit request failed:", error.message);

    return res.status(502).json({
      success: false,
      error: "Failed to fetch RailKit data",
      detail: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
