import { describe, expect, it } from 'vitest';
import {
  companionNotificationLink,
  filterNotificationsForProfile,
  isCompanionRelevantNotification,
} from './companionNotifications.js';

describe('companionNotificationLink', () => {
  it('rewrites Autoturisme from the full-TMS vehicles path', () => {
    expect(companionNotificationLink('/vehicles')).toBe('/fleet');
  });

  it('sends vehicle document_expiry to the ITP board', () => {
    expect(companionNotificationLink('/vehicles', { type: 'document_expiry' })).toBe('/fleet/itp');
  });
});

describe('isCompanionRelevantNotification', () => {
  it('keeps driver uploads and fleet MTMA alerts', () => {
    expect(isCompanionRelevantNotification({
      type: 'driver_upload', link: '/avize',
    })).toBe(true);
    expect(isCompanionRelevantNotification({
      type: 'data_issue', link: '/fleet',
    })).toBe(true);
    expect(isCompanionRelevantNotification({
      type: 'document_expiry', link: '/vehicles',
    })).toBe(true);
  });

  it('drops trip / CMR / client alerts', () => {
    expect(isCompanionRelevantNotification({
      type: 'trip_status', link: '/trips/1',
    })).toBe(false);
    expect(isCompanionRelevantNotification({
      type: 'trip_unassigned', link: '/trips/1',
    })).toBe(false);
    expect(isCompanionRelevantNotification({
      type: 'cmr_pending', link: '/trips/1',
    })).toBe(false);
    expect(isCompanionRelevantNotification({
      type: 'client_confirmed', link: '/trips/1',
    })).toBe(false);
    expect(isCompanionRelevantNotification({
      type: 'route_exception', link: '/live',
    })).toBe(false);
  });

  it('drops data issues that only open Curse or Controale', () => {
    expect(isCompanionRelevantNotification({
      type: 'data_issue', link: '/trips/abc',
    })).toBe(false);
    expect(isCompanionRelevantNotification({
      type: 'data_issue', link: '/checks',
    })).toBe(false);
  });

  it('drops driver-document expiry (no Șoferi screen on companion)', () => {
    expect(isCompanionRelevantNotification({
      type: 'document_expiry', link: '/drivers',
    })).toBe(false);
  });
});

describe('filterNotificationsForProfile', () => {
  const mixed = [
    { id: '1', type: 'trip_status', link: '/trips/1', is_read: false },
    { id: '2', type: 'driver_upload', link: '/avize', is_read: false },
    { id: '3', type: 'document_expiry', link: '/vehicles', is_read: true },
  ];

  it('leaves the inbox alone on full TMS', () => {
    expect(filterNotificationsForProfile(mixed, { companion: false })).toEqual(mixed);
  });

  it('keeps only companion rows and rewrites vehicle expiry to ITP', () => {
    expect(filterNotificationsForProfile(mixed, { companion: true })).toEqual([
      { id: '2', type: 'driver_upload', link: '/avize', is_read: false },
      { id: '3', type: 'document_expiry', link: '/fleet/itp', is_read: true },
    ]);
  });
});
