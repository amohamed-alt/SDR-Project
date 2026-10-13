import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctProspectPhones, missingProspectPhoneProperties } from '../src/lib/prospect-phone-details.ts';
test('keeps distinct revealed numbers and merges formatting duplicates', () => {
  assert.deepEqual(distinctProspectPhones(['+966 55 123 4567','00966551234567','+966112345678','0000000000','']), ['+966 55 123 4567','+966112345678']);
});
test('writes explicit mobile and an alternate phone into separate CRM fields', () => {
  assert.deepEqual(missingProspectPhoneProperties({phone:'+966551234567',mobilephone:'+966551234567',phones:['+966551234567','+966112345678']}),{mobilephone:'+966551234567',phone:'+966112345678'});
});
test('does not replace existing CRM numbers', () => {
  assert.deepEqual(missingProspectPhoneProperties({phone:'+966551234567',mobilephone:'+966559876543'}, {phone:'+966112345678',mobilephone:'+966501234567'}),{});
});
test('accepts an alternate when primary is absent without inventing mobile classification', () => {
  assert.deepEqual(missingProspectPhoneProperties({phones:['+971501234567']}),{phone:'+971501234567'});
});
