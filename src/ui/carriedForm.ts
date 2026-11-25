/** The carried row's form (E8, 17 Nov): the full pill in the list and over Bookmarks, the 28 px icon chip anywhere else, and always over Favorites: the row area counts the Favorites
 *  grid as one of its zones, so over it the pill never shrank. `inRowArea` may be a function: over Favorites it is not read at all. */
export function carriedAsPill({overFavorites,saving,inRowArea}:{overFavorites:boolean;saving:boolean;inRowArea:boolean|(()=>boolean)}):boolean{
  if(overFavorites)return false;
  return saving||(typeof inRowArea==='function'?inRowArea():inRowArea);
}
