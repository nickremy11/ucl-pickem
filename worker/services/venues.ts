/**
 * Home grounds, keyed by football-data.org team id.
 *
 * Curated by hand rather than taken from the provider: its `venue` and
 * `address` fields are stale or wrong for several clubs (old stadium names,
 * training-ground addresses, a club still listed in a city it cannot play in),
 * and it exposes no per-match venue at all. A team missing from this table
 * simply shows no venue, which is better than showing a wrong one.
 *
 * Shakhtar Donetsk are deliberately absent: they play "home" games at a
 * borrowed ground that changes between seasons.
 *
 * The country shown is the team's own, so this assumes a club hosts in its
 * home country. Re-check this table when a new season's teams are loaded.
 */
export interface Ground {
  stadium: string;
  city: string;
}

const GROUNDS: Record<number, Ground> = {
  4: { stadium: "Signal Iduna Park", city: "Dortmund" }, // Dortmund
  5: { stadium: "Allianz Arena", city: "Munich" }, // Bayern
  10: { stadium: "MHPArena", city: "Stuttgart" }, // Stuttgart
  57: { stadium: "Emirates Stadium", city: "London" }, // Arsenal
  58: { stadium: "Villa Park", city: "Birmingham" }, // Aston Villa
  64: { stadium: "Anfield", city: "Liverpool" }, // Liverpool
  65: { stadium: "Etihad Stadium", city: "Manchester" }, // Man City
  66: { stadium: "Old Trafford", city: "Manchester" }, // Man United
  78: { stadium: "Riyadh Air Metropolitano", city: "Madrid" }, // Atleti
  81: { stadium: "Spotify Camp Nou", city: "Barcelona" }, // Barça
  86: { stadium: "Santiago Bernabéu", city: "Madrid" }, // Real Madrid
  90: { stadium: "Estadio Benito Villamarín", city: "Seville" }, // Real Betis
  94: { stadium: "Estadio de la Cerámica", city: "Villarreal" }, // Villarreal
  100: { stadium: "Stadio Olimpico", city: "Rome" }, // Roma
  108: { stadium: "San Siro", city: "Milan" }, // Inter
  113: { stadium: "Stadio Diego Armando Maradona", city: "Naples" }, // Napoli
  498: { stadium: "Estádio José Alvalade", city: "Lisbon" }, // Sporting CP
  503: { stadium: "Estádio do Dragão", city: "Porto" }, // Porto
  521: { stadium: "Stade Pierre-Mauroy", city: "Villeneuve-d'Ascq" }, // Lille
  524: { stadium: "Parc des Princes", city: "Paris" }, // PSG
  546: { stadium: "Stade Bollaert-Delelis", city: "Lens" }, // RC Lens
  610: { stadium: "RAMS Park", city: "Istanbul" }, // Galatasaray
  613: { stadium: "Şükrü Saracoğlu Stadium", city: "Istanbul" }, // Fenerbahçe
  674: { stadium: "Philips Stadion", city: "Eindhoven" }, // PSV
  675: { stadium: "De Kuip", city: "Rotterdam" }, // Feyenoord
  721: { stadium: "Red Bull Arena", city: "Leipzig" }, // RB Leipzig
  851: { stadium: "Jan Breydel Stadium", city: "Bruges" }, // Club Brugge
  930: { stadium: "Sinobo Stadium", city: "Prague" }, // Slavia Praha
  1899: { stadium: "OPAP Arena", city: "Athens" }, // PAE AEK
  2016: { stadium: "Raiffeisen Arena", city: "Linz" }, // LASK
  5720: { stadium: "SR-Bank Arena", city: "Stavanger" }, // Viking
  5721: { stadium: "Aspmyra Stadion", city: "Bodø" }, // Bodø/Glimt
  7397: { stadium: "Stadio Giuseppe Sinigaglia", city: "Como" }, // Como 1907
  7509: { stadium: "Tehelné pole", city: "Bratislava" }, // Sl. Bratislava
  10233: { stadium: "Dalga Arena", city: "Baku" }, // Sabah FK
};

export function groundFor(providerTeamId: number | undefined): Ground | null {
  return providerTeamId === undefined ? null : (GROUNDS[providerTeamId] ?? null);
}

export type Side = "SIDE_A" | "SIDE_B";

export interface ContestVenue {
  /** 1 or 2 for a two-legged tie, null when there is only one match. */
  leg: 1 | 2 | null;
  host: Side;
  stadium: string;
  city: string;
  country: string | null;
}

/**
 * Where a contest is played and who hosts, one entry per match.
 *
 * The host comes from each fixture's own home team rather than from the side
 * order, so it stays right if the provider ever swaps a leg. Single-leg ties
 * (the final) are played at a neutral ground the provider does not publish, so
 * they return nothing instead of implying a home side. A host whose ground is
 * not in the table is skipped for the same reason.
 */
export function contestVenues(input: {
  sideATeamId: string;
  sideBTeamId: string;
  singleLeg: boolean;
  legs: { homeTeamId: string; kickoffAt: Date }[];
  groundOf: (teamId: string) => Ground | null;
  countryOf: (teamId: string) => string | null;
}): ContestVenue[] {
  if (input.singleLeg) return [];

  const legs = input.legs.slice().sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  const out: ContestVenue[] = [];

  legs.forEach((fx, i) => {
    const ground = input.groundOf(fx.homeTeamId);
    if (!ground) return;
    const host: Side = fx.homeTeamId === input.sideATeamId ? "SIDE_A" : "SIDE_B";
    out.push({
      leg: legs.length === 2 ? ((i + 1) as 1 | 2) : null,
      host,
      stadium: ground.stadium,
      city: ground.city,
      country: input.countryOf(fx.homeTeamId),
    });
  });

  return out;
}
