import { describe, expect, it } from 'vitest';
import { leaguePackageSeasonOffer } from '../src/data/products';

// Sign up during a season and the rest of it is free (Brandon, 2026-11-07).
// The offer must end on its own after the fantasy championship and stay off
// through the offseason, or the site keeps promising a "rest of the season"
// that no longer exists.
describe('leaguePackageSeasonOffer', () => {
	it('runs mid-season and names the season', () => {
		const offer = leaguePackageSeasonOffer(new Date('2026-11-07T12:00:00-08:00'));
		expect(offer).toContain('2026 season');
		expect(offer).toContain('first full season');
	});

	it('is still on in the championship week', () => {
		expect(leaguePackageSeasonOffer(new Date('2026-12-28T12:00:00-08:00'))).not.toBeNull();
	});

	it('is off after the season and through the offseason', () => {
		expect(leaguePackageSeasonOffer(new Date('2027-01-15T12:00:00-08:00'))).toBeNull();
		expect(leaguePackageSeasonOffer(new Date('2027-03-01T12:00:00-08:00'))).toBeNull();
		expect(leaguePackageSeasonOffer(new Date('2027-08-20T12:00:00-07:00'))).toBeNull();
	});

	it('comes back with the next season', () => {
		expect(leaguePackageSeasonOffer(new Date('2027-10-01T12:00:00-07:00'))).toContain('2027 season');
	});
});
