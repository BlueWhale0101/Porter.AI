import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateController } from '../client/updates.js';
import { InteractionController } from '../client/interaction.js';

for(const kind of ['door','details','quick','edit','trip-edit','sign-in'])test(`worker update waits for explicit consent and ${kind} ownership`,async()=>{
  const interactions=new InteractionController();let activated=0,reloads=0;
  const update=createUpdateController({interactions,activate:async()=>{activated++;return {accepted:true};},reload:()=>reloads++});
  const owner=interactions.begin(kind);update.ready();await update.safe();assert.equal(activated,0);
  await update.request();assert.equal(activated,0);assert.equal(reloads,0);
  // An obsolete owner cannot release a newer interaction.
  const newer=interactions.begin(kind);interactions.release(owner);await update.safe();assert.equal(activated,0);
  interactions.release(newer);await update.safe();assert.equal(activated,1);
  const raced=interactions.begin('door');await update.controllerChanged();assert.equal(reloads,0);
  interactions.release(raced);await update.safe();await update.controllerChanged();assert.equal(reloads,1);
});
test('another window blocks activation and can be retried without forcing a reload',async()=>{
  const interactions=new InteractionController();let allowed=false,reloads=0;
  const update=createUpdateController({interactions,activate:async()=>({accepted:allowed,reason:'Close other windows'}),reload:()=>reloads++});
  update.ready();await update.request();assert.equal(update.state.error,'Close other windows');assert.equal(reloads,0);
  allowed=true;await update.request();await update.controllerChanged();assert.equal(reloads,1);
});
