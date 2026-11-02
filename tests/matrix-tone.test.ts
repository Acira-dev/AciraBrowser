import test from 'node:test';
import assert from 'node:assert/strict';
import {toneColors} from '../src/ui/matrixTone';

test('ink lights take the colour of the text around them, so they show on dark surfaces',()=>{
  assert.deepEqual(toneColors('ink','rgb(236, 237, 240)','#3b6eea'),['rgba(236,237,240,1)','rgba(236,237,240,0.085)']);
  assert.deepEqual(toneColors('ink','rgba(37, 38, 43, 0.84)','#3b6eea'),['rgba(37,38,43,0.84)','rgba(37,38,43,0.085)']);
});

test('soft lights are a quieter ink, and accent lights follow the finish accent',()=>{
  assert.deepEqual(toneColors('soft','rgb(236, 237, 240)','#3b6eea'),['rgba(236,237,240,0.42)','rgba(236,237,240,0.06)']);
  assert.deepEqual(toneColors('accent','rgb(236, 237, 240)','#4d1821'),['#4d1821','rgba(77,24,33,0.16)']);
});

test('unreadable colours fall back to the light-theme ink',()=>{
  assert.deepEqual(toneColors('ink','','not-a-colour'),['rgba(37,38,43,1)','rgba(37,38,43,0.085)']);
  assert.deepEqual(toneColors('accent','','not-a-colour'),['#3b6eea','rgba(59,110,234,0.16)']);
});
