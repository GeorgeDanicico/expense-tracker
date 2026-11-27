/**
 * Which merchant an expense's description names, so "Kaufland Satu Mare", "Kaufland Cluj-Manastur",
 * "Kaufland" and "Kaufland meal-ticket purchase" all count as Kaufland in the spending comparisons and
 * the recurring payments.
 *
 * Two steps, tried in order:
 * 1. A known brand anywhere in the description, as whole words ("Abonament chatgpt" is ChatGPT).
 * 2. Otherwise the description itself, without what follows the name: a city, a store number or a
 *    company form ("Help Net 219 Satu Mare" and "Help Net 226 Satu Mare" are "Help Net").
 *
 * Generic descriptions ("Groceries", "Transport", "Ride", "Retail purchase") name no merchant and give
 * null: they're left out of merchant comparisons, but still count in their category.
 *
 * Not the same as `merchant_key` in the database (expense_classification_private), which is a short,
 * reviewed list the statement reader trusts to set a category. This one only groups for display, so it
 * may be broader.
 */

export type Merchant = { key: string; label: string };

/** Lower case, no diacritics, punctuation as spaces (dots and ampersands kept for "apple.com", "h&m"). */
function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9.&]+/g, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Known brands: the label shown, and the word sequences that name it. */
const BRANDS: readonly { label: string; names: readonly string[] }[] = [
  // Groceries and food delivery
  { label: "Kaufland", names: ["kaufland"] },
  { label: "Lidl", names: ["lidl"] },
  { label: "Carrefour", names: ["carrefour"] },
  { label: "Auchan", names: ["auchan"] },
  { label: "Profi", names: ["profi"] },
  { label: "Penny", names: ["penny"] },
  { label: "Mega Image", names: ["mega image"] },
  { label: "Selgros", names: ["selgros"] },
  { label: "Metro", names: ["metro cash", "metro"] },
  { label: "Glovo", names: ["glovo"] },
  { label: "Wolt", names: ["wolt"] },
  { label: "Tazz", names: ["tazz"] },
  { label: "Foodpanda", names: ["foodpanda"] },
  // Transport and fuel
  { label: "Bolt", names: ["bolt"] },
  { label: "Uber", names: ["uber"] },
  { label: "OMV", names: ["omv"] },
  { label: "Petrom", names: ["petrom"] },
  { label: "MOL", names: ["mol"] },
  { label: "Rompetrol", names: ["rompetrol"] },
  { label: "Lukoil", names: ["lukoil"] },
  { label: "Socar", names: ["socar"] },
  { label: "CNAIR", names: ["cnair"] },
  { label: "Autonet", names: ["autonet"] },
  // Shopping
  { label: "eMAG", names: ["emag"] },
  { label: "Altex", names: ["altex"] },
  { label: "Flanco", names: ["flanco"] },
  { label: "Dedeman", names: ["dedeman"] },
  { label: "Leroy Merlin", names: ["leroy merlin"] },
  { label: "IKEA", names: ["ikea"] },
  { label: "JYSK", names: ["jysk"] },
  { label: "Decathlon", names: ["decathlon"] },
  { label: "About You", names: ["about you"] },
  { label: "Answear", names: ["answear", "answear.ro"] },
  { label: "H&M", names: ["h&m"] },
  { label: "Zara", names: ["zara"] },
  { label: "LC Waikiki", names: ["lc waikiki"] },
  { label: "Pepco", names: ["pepco"] },
  // Health
  { label: "Help Net", names: ["help net", "helpnet"] },
  { label: "Catena", names: ["catena"] },
  { label: "Dr. Max", names: ["dr max", "dr.max"] },
  { label: "Sensiblu", names: ["sensiblu"] },
  { label: "Farmacia Tei", names: ["farmacia tei"] },
  // Entertainment and subscriptions
  { label: "Cineplexx", names: ["cineplexx"] },
  { label: "Cinema City", names: ["cinema city"] },
  { label: "Netflix", names: ["netflix"] },
  { label: "Spotify", names: ["spotify"] },
  { label: "HBO Max", names: ["hbo max", "hbo", "max.com"] },
  { label: "Disney+", names: ["disney plus", "disney"] },
  { label: "YouTube Premium", names: ["youtube premium", "youtube"] },
  { label: "Apple", names: ["apple.com", "apple"] },
  { label: "Google", names: ["google"] },
  { label: "ChatGPT", names: ["chatgpt", "chat gpt", "openai"] },
  // Utilities, telecom and insurance
  { label: "Digi", names: ["digi", "rcs rds"] },
  { label: "Orange", names: ["orange"] },
  { label: "Vodafone", names: ["vodafone"] },
  { label: "Telekom", names: ["telekom"] },
  { label: "Enel", names: ["enel"] },
  { label: "E.ON", names: ["e.on", "eon"] },
  { label: "Engie", names: ["engie"] },
  { label: "PPC", names: ["ppc"] },
  { label: "Allianz-Tiriac", names: ["allianz tiriac", "allianz"] },
  { label: "Groupama", names: ["groupama"] },
  { label: "Omniasig", names: ["omniasig"] },
];

/** Each brand name as its words, longest first, so "mega image" is tried before shorter names. */
const BRAND_NAMES = BRANDS.flatMap((brand) => brand.names.map((name) => ({ brand, words: name.split(" ") })))
  .toSorted((a, b) => b.words.length - a.words.length);

/** Words that describe a purchase rather than name a merchant, in English and Romanian. */
const GENERIC_WORDS = new Set([
  "groceries", "grocery", "transport", "public", "meal", "meals", "ride", "rides", "fuel", "retail",
  "shopping", "purchase", "purchases", "personal", "care", "gift", "gifts", "books", "book", "expense",
  "expenses", "card", "payment", "payments", "pos", "bus", "parking", "local", "service", "services",
  "fee", "fees", "bank", "transfer", "cash", "withdrawal", "atm", "other", "misc", "food", "taxi",
  "lunch", "dinner", "breakfast", "coffee", "and", "the", "a", "of", "for", "to", "de", "si", "la",
  "pentru", "cumparaturi", "mancare", "benzina", "motorina", "cadou", "bani", "diverse", "plata",
  "taxa", "comision", "retragere", "numerar",
]);

/** Places and company forms that follow a merchant's name ("Kaufland Satu Mare", "Dersidan SRL"). */
const TRAILING_PLACES = new Set([
  "satu mare", "cluj napoca", "cluj", "manastur", "cluj manastur", "napoca", "timisoara", "bucuresti",
  "bucharest", "iasi", "oradea", "voluntari", "brasov", "sibiu", "constanta", "baia mare", "arad",
  "craiova", "targu mures", "suceava", "pitesti", "ploiesti", "galati", "bacau", "carei", "tallinn",
  "romania", "ro", "srl", "s.r.l", "sa", "s.a", "ltd", "gmbh", "ifn", "online", "store",
]);

const isNumber = (word: string) => /^\d+$/.test(word);

/** `words` with any place, company form or store number at the end taken off (up to three words at a time). */
function withoutTrailing(words: string[]) {
  const kept = [...words];
  let changed = true;
  while (changed && kept.length > 1) {
    changed = false;
    for (let size = Math.min(3, kept.length - 1); size >= 1; size -= 1) {
      const tail = normalize(kept.slice(-size).join(" "));
      if (TRAILING_PLACES.has(tail) || (size === 1 && isNumber(tail))) {
        kept.splice(-size);
        changed = true;
        break;
      }
    }
  }
  return kept;
}

/** A word without a web domain's ending, so "netflix.com" is also tried as "netflix". */
const withoutDomain = (word: string) => word.replace(/\.(com|ro|net|org|eu|io|co)$/, "");

function findBrand(words: readonly string[]) {
  const bare = words.map(withoutDomain);
  for (const { brand, words: name } of BRAND_NAMES) {
    for (let start = 0; start + name.length <= words.length; start += 1) {
      if (name.every((word, offset) => words[start + offset] === word || bare[start + offset] === word)) return brand;
    }
  }
  return null;
}

/** The merchant `description` names, or null for a generic description. */
export function merchantOf(description: string): Merchant | null {
  const normalized = normalize(description);
  if (!normalized) return null;
  const words = normalized.split(" ");

  const brand = findBrand(words);
  if (brand) return { key: normalize(brand.label), label: brand.label };

  if (words.every((word) => GENERIC_WORDS.has(word) || isNumber(word))) return null;
  const label = withoutTrailing(description.trim().split(/\s+/)).join(" ");
  const key = normalize(label);
  if (key.length < 2 || key.split(" ").every((word) => GENERIC_WORDS.has(word) || isNumber(word))) return null;
  return { key, label };
}
