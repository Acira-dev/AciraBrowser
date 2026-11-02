/** One frame of the active-tab surface following its tab's rendered box. */
export interface FollowBox {x:number;width:number}
export const followSettleMs=700;

/**
 * `moved`: write the new box this frame. The first frame after a change has no last box (NaN) and always writes, so a
 * tab that is already in place (the one left of a closed last tab, a reopened tab) is still reached.
 * `settled`: consecutive quiet frames. Quiet frames can precede a layout animation, so the count only grows once the
 * tab is at its computed destination, or after followSettleMs for a box that rests a little off it (display scaling).
 * Time, not a frame count: a frame budget runs out faster on a faster display and left the surface behind mid-move.
 */
export function followFrame(last:FollowBox,next:FollowBox,target:FollowBox,elapsed:number,dragging:boolean,settled:number):{moved:boolean;settled:number} {
 const moved=!(Math.abs(last.x-next.x)<.01&&Math.abs(last.width-next.width)<.01);
 const arrived=Math.abs(next.x-target.x)<.5&&Math.abs(next.width-target.width)<.5;
 return {moved,settled:!dragging&&!moved&&(arrived||elapsed>followSettleMs)?settled+1:0};
}
