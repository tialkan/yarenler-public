import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomToken,digest,equalState,validSessionToken} from '../src/server/auth-security.ts';
test('OAuth state rejects absent, malformed and mismatched states',()=>{const state=randomToken();assert.equal(equalState(state,state),true);for(const other of ['',state.slice(1),randomToken(),state+'x'])assert.equal(equalState(state,other),false);assert.equal(equalState('',''),false);assert.equal(equalState('a','a'),false);});
test('Session tokens are unpredictable and stored as fixed SHA256 digests',()=>{const tokens=Array.from({length:100},randomToken);assert.equal(new Set(tokens).size,100);for(const token of tokens){assert.equal(validSessionToken(token),true);assert.equal(digest(token).length,32);assert.notEqual(digest(token).toString('hex'),token);}for(const token of ['',"' OR 1=1",'a'.repeat(44)])assert.equal(validSessionToken(token),false);});
