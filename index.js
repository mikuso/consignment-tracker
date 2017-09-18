const _ = require('lodash');

module.exports = function(config) {
    if (!config) {
        config = {};
    }

    const couriers = [
        require('./couriers/ups')(config.ups || {}),
        require('./couriers/truline')(config.truline || {}),
        require('./couriers/yodel')(config.yodel || {})
    ];

    return async function track(input, trackOptions) {
        trackOptions = Object.assign({
            history: false
        }, trackOptions || {});

        let refs = (Array.isArray(input) ? input : [input]).map(ref => {
            for (let courier of couriers) {
                if (courier.pattern.test(ref)) {
                    return {ref, courier};
                }
            }
            return {
                ref,
                error: Error(`Couldn't identify tracking number: ${ref}`)
            };
        });

        refs = _.shuffle(refs);

        let promises = [];
        for (let courier of couriers) {
            let crefs = refs.filter(ref => ref.courier === courier).map(r=>r.ref);
            if (!crefs.length) continue;
            promises.push(courier.track(crefs, trackOptions));
        }

        let results = (await Promise.all(promises)).reduce((results, res) => {
            results.push(...res);
            return results;
        }, []);

        let badlookups = refs.filter(r => r.error);
        if (badlookups.length) {
            results.push(...badlookups);
        }

        if (Array.isArray(input)) {
            if (!results.length) {
                throw Error("No results returned");
            }
            return results;
        }
        const result = results[0];
        if (result.error) {
            throw result.error;
        }
        return result;

    };
};
