/**
 * A line per selected author saying who they are at ZMO, from their zmo.de
 * page: current or former, position, research unit, and links to the page
 * and their ORCID record.
 *
 * Shown only while authors are selected, under the filter chips, because that
 * is the moment a reader asks "who is this?". An author with no matched page
 * says so rather than vanishing, so the absence is not mistaken for a bug.
 */

import { el, mount } from '../utils/dom.js';

export class AuthorProfiles {
    constructor(container, { strings }) {
        this.container = container;
        this.strings = strings;
    }

    render(authors, people) {
        if (!authors.size) {
            this.container.hidden = true;
            this.container.replaceChildren();
            return;
        }
        const s = this.strings;
        const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
        this.container.hidden = false;
        mount(this.container, el('div', { class: 'profiles' }, [
            el('h2', { class: 'profiles__title', text: s.authorProfiles }),
            el('ul', { class: 'profiles__list' }, [...authors].sort().map(name => {
                const person = people[name];
                if (!person) {
                    return el('li', { class: 'profile' }, [el('strong', { text: name }), ' — ', el('span', { class: 'profile__none', text: s.noProfile })]);
                }
                const parts = [
                    person.current ? s.zmoCurrent : s.zmoFormer,
                    person.position,
                    ...(person.units ?? []).map(unit => s.unitLabel[unit] ?? unit)
                ].filter(Boolean);
                return el('li', { class: 'profile' }, [
                    el('strong', { text: name }), ' — ', parts.join(' · '), ' · ',
                    link(person.url, s.zmoProfile),
                    person.orcid ? ' · ' : null,
                    person.orcid ? link(`https://orcid.org/${person.orcid}`, `ORCID ${person.orcid}`) : null
                ]);
            })),
            el('p', { class: 'explore-hint', text: s.peopleNote })
        ]));
    }

    destroy() {
        this.container.replaceChildren();
    }
}
