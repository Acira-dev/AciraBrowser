import levels from '../../page-zoom-levels.json';
export const nextPageZoom=(current:number,direction:number)=>direction>0?(levels.find(value=>value>Math.round(current))||500):([...levels].reverse().find(value=>value<Math.round(current))||25);
