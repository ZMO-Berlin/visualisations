import { ERROR_EVENTS, WORDCLOUD_EVENTS, UI_EVENTS } from '../EventTypes.js';

/**
 * Payload contracts for events that carry data other components depend on.
 * Events without an entry pass through unchecked.
 */
const eventSchemas = {
    [WORDCLOUD_EVENTS.UPDATE]: {
        required: ['words'],
        validate: data => Array.isArray(data.words)
    },
    [UI_EVENTS.UNIT_CHANGE]: {
        required: ['unit'],
        validate: data => typeof data.unit === 'string' && data.unit.length > 0
    },
    [UI_EVENTS.WORD_COUNT_CHANGE]: {
        required: ['count'],
        validate: data => Number.isInteger(data.count) && data.count > 0
    }
};

export const ValidationMiddleware = (eventType, data) => {
    const schema = eventSchemas[eventType];
    if (!schema) return data;

    const missingFields = schema.required.filter(field => !(field in data));
    if (missingFields.length > 0) {
        const error = new Error(`${eventType}: missing required field(s) ${missingFields.join(', ')}`);
        error.code = ERROR_EVENTS.VALIDATION;
        throw error;
    }

    if (schema.validate && !schema.validate(data)) {
        const error = new Error(`${eventType}: payload failed validation`);
        error.code = ERROR_EVENTS.VALIDATION;
        throw error;
    }

    return data;
};
