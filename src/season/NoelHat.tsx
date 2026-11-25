/** A flat Santa hat on a round profile picture: a red cap with one darker fold, a white band that follows the top of the circle, a white pompom. No gradients, no fur, no shadow (reported 22 Nov).
 *  Put it inside a `position: relative` box the size of the picture. Still: nothing animates but its drop-in when the theme turns on (noel.css). */
export function NoelHat() {
  return <svg className="noel-hat" viewBox="0 0 30 30" aria-hidden="true">
    <path className="cap" d="M5.2 10.6C5.6 5 10 1.5 15.5 1.6c5.1.1 9.2 3.3 10.7 9.1-1.2-1-2.4-1.6-3.7-1.8C17.3 8.1 10.8 8.3 5.2 10.6z"/>
    <path className="fold" d="M16 1.7c4.4.7 8.2 3.7 10.2 8.9-1.6-2.5-3.5-4.1-6-4.8C19.1 4 17.7 2.7 16 1.7z"/>
    <path className="bandline" d="M4.4 13.6Q14 6.4 23.6 13.6"/><path className="band" d="M4.4 13.6Q14 6.4 23.6 13.6"/>
    <circle className="pom" cx="26.1" cy="11.9" r="2.6"/>
  </svg>;
}
