import type { WorkspaceGlyphId } from '../../runtime/workspaces';

/**
 * R4-48 P0-6: a new workspace's icon follows its name, so "Work" no longer gets a house. Words are matched whole, in
 * English and the most common words of the shipped languages; the person's own pick always wins (the editor stops
 * following once they choose). Nothing matched: the editor keeps the first glyph no other workspace wears.
 */
const WORDS: [WorkspaceGlyphId, string[]][] = [
  ['bag', ['work', 'job', 'office', 'business', 'client', 'clients', 'meeting', 'meetings', 'shop', 'shopping', 'arbeit', 'travail', 'trabajo', 'lavoro', 'trabalho', 'werk', 'praca']],
  ['home', ['home', 'personal', 'life', 'family', 'house', 'privat', 'privé', 'personnel', 'personal', 'casa', 'hogar', 'thuis', 'zuhause', 'dom']],
  ['book', ['study', 'school', 'uni', 'university', 'college', 'class', 'classes', 'learn', 'learning', 'reading', 'read', 'books', 'homework', 'studium', 'études', 'estudio', 'studio', 'estudos']],
  ['flask', ['research', 'science', 'lab', 'experiments', 'experiment', 'forschung', 'recherche', 'investigación', 'ricerca']],
  ['code', ['code', 'coding', 'dev', 'development', 'engineering', 'programming', 'github']],
  ['palette', ['design', 'art', 'creative', 'photo', 'photos', 'drawing', 'kunst']],
  ['globe', ['travel', 'trip', 'trips', 'world', 'news', 'reise', 'voyage', 'viaje', 'viaggio']],
  ['users', ['team', 'friends', 'social', 'people', 'community', 'freunde', 'amis', 'amigos']],
  ['headphones', ['music', 'podcast', 'podcasts', 'audio', 'musik', 'musique', 'música', 'musica']],
  ['video', ['video', 'videos', 'movies', 'movie', 'film', 'films', 'watch', 'youtube', 'tv']],
  ['mail', ['mail', 'email', 'inbox', 'messages']],
  ['star', ['side', 'project', 'projects', 'ideas', 'fun', 'hobby', 'hobbies', 'favorites', 'favourites']],
  ['terminal', ['terminal', 'server', 'servers', 'ops', 'admin', 'infra']],
  ['file', ['docs', 'documents', 'writing', 'notes', 'write', 'blog']],
  ['bolt', ['focus', 'urgent', 'sprint', 'today', 'launch']],
];
const INDEX = new Map(WORDS.flatMap(([glyph, words]) => words.map(word => [word, glyph] as const)));

/** The glyph a name suggests ("Side project" takes the star, "Study" the book), or undefined. The first matching word wins. */
export function suggestedGlyph(name: string): WorkspaceGlyphId | undefined {
  for (const word of name.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const glyph = word && INDEX.get(word);
    if (glyph) return glyph;
  }
  return undefined;
}
