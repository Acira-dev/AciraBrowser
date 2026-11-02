export type PopupCaptureStream=Pick<MediaStream,'getTracks'>;

export function stopPopupCapture(stream:PopupCaptureStream){for(const track of stream.getTracks())track.stop();}

/** One effect generation owns its acquisitions, including promises that resolve
 * after it closes. Frozen canvas pixels have a separate, popup-local lifetime. */
export function createPopupCaptureLifetime(){
 let closed=false;
 const streams=new Set<PopupCaptureStream>();
 return{
  get closed(){return closed;},
  adopt(stream:PopupCaptureStream){if(closed){stopPopupCapture(stream);return false;}streams.add(stream);return true;},
  release(stream:PopupCaptureStream){if(streams.delete(stream))stopPopupCapture(stream);},
  close(){if(closed)return;closed=true;for(const stream of streams)stopPopupCapture(stream);streams.clear();},
 };
}
