/**
 * Suggestions for the city field on an event.
 *
 * A `datalist`, not a `select`: the field stays free text so a village that
 * sells tickets once a year is not locked out, while the common spelling is
 * one click away — the filter groups cities by a de-accented key, so it is the
 * spelling that matters, not the exact string.
 */
export const SK_CITY_SUGGESTIONS = [
  'Bratislava',
  'Košice',
  'Prešov',
  'Žilina',
  'Nitra',
  'Banská Bystrica',
  'Trnava',
  'Trenčín',
  'Martin',
  'Poprad',
  'Prievidza',
  'Zvolen',
  'Považská Bystrica',
  'Michalovce',
  'Nové Zámky',
  'Spišská Nová Ves',
  'Komárno',
  'Levice',
  'Humenné',
  'Liptovský Mikuláš',
  'Ružomberok',
  'Piešťany',
  'Bardejov',
  'Lučenec',
  'Topoľčany',
] as const
