const PromiseQueue = require('promise-queue');
const Promise = require('bluebird');
const request = Promise.promisify(require('request'));
const cheerio = require('cheerio');
const moment = require('moment');
const TrackingResultBuilder = require('../tracking-result-builder');
const crypto = require('crypto');

function ttaccount(account) {
    account = String(account);
    let base = crypto.randomBytes(18).toString('hex');
    return [
        base.substr(0,3),
        account.charAt(0),
        base.substr(3,6),
        account.charAt(1),
        base.substr(9,6),
        account.charAt(2),
        base.substr(15,3),
        account.charAt(3),
        base.substr(18,11),
        account.charAt(4),
        base.substr(29,6)
    ].join("").toUpperCase();
}

module.exports = function({concurrency = 2, account, cacheSize = 1000}){

    const trackingQueue = new PromiseQueue(concurrency, Infinity);

    const trackAndTraceCache = [];
    async function trackAndTrace(account, reference) {

        // check if reference already in cache
        while (true) {
            const cached = trackAndTraceCache.find(c => c.reference === reference);
            if (!cached) break;

            try {
                return await cached.url;
            } catch (e) {
                // if error on T&T, remove from cache and try again
                let idx = trackAndTraceCache.indexOf(cached);
                if (idx !== -1) trackAndTraceCache.splice(idx, 1);
            }
        }

        // create new trace
        let trace = {reference};
        trace.url = (async () => {
            let res = await request({
                url: 'https://app.voweurope.com/apps/waybill/results.asp?t=byref',
                method: 'post',
                form: {
                    ref: reference,
                    Submit6: 'Search',
                    strAccount: ttaccount(account)
                }
            });

            const $ = cheerio.load(res.body);
            const anchor = $('a').toArray().find(a => $(a).text().trim() === reference);
            if (!anchor) {
                throw Error(`Can't find tracking reference ${reference} in Track&Trace`);
            }
            let url = $(anchor).attr('href');
            if (!url) {
                throw Error(`URL not found with anchor tag for tracking reference ${reference}`);
            }
            return url;
        })();
        trackAndTraceCache.push(trace);
        return await trace.url;

        while (trackAndTraceCache.length > 1000) {
            trackAndTraceCache.shift();
        }
    }

    function buildResult(events, refs, history) {
        let rb = new TrackingResultBuilder({
            courier: "truline",
            tracking_ref: refs.trackingNumber,
            consignment_ref: refs.refNum,
            po_number: refs.purchaseOrderNumber
        });

        for (let event of events) {
            let hist = {
                description: (event.status + " - " + event.description) || "Unknown",
                date: event.date,
                pod_image_url: event.pod
            };

            switch (event.description.toLowerCase()) {
                case 'delivered':
                    hist.status_code = 'D';
                    break;
                case 'out of time':
                case 'not received in hub':
                case 'failed delivery':
                case 'in transit to hub\\awaiting scan':
                    hist.status_code = 'X';
                    break;
                default:
                    hist.status_code = (event.status === 'Exception') ? 'X' : 'I';
                    break;
            }

            rb.addHistory(hist);
        }

        return rb.toJSON({history: history});
    }

    /**
     * Tracking
     * @param  {[type]} trackingNumber [description]
     * @param  {[type]} trackOptions   [description]
     * @return {[type]}                [description]
     */
    async function track(trackingNumber, trackOptions) {
        return trackingQueue.add(async () => {
            if (Array.isArray(trackingNumber)) {
                return Promise.all(trackingNumber.map(num => track(num, trackOptions).catch(error => ({tracking_ref: num, error}))));
            }

            let refAcct = account;
            let refNum = trackingNumber;

            let trackNoSplit = trackingNumber.split('/');
            if (trackNoSplit.length === 2) {
                refAcct = trackNoSplit[0];
                refNum = trackNoSplit[1];
            }

            let url = await trackAndTrace(refAcct, refNum);
            let res = await request(url);

            if (res.statusCode !== 200) {
                throw new Exception(`HTTP error ${res.statusCode}`);
            }

            let events = [];
            let $ = cheerio.load(res.body);
            for (let tr of $('.tracking-results tbody tr').toArray()) {
                events.push({
                    status: $('td:nth-child(1)', tr).text().trim(),
                    description: $('td:nth-child(2)', tr).text().trim(),
                    boxes: +$('td:nth-child(3)', tr).text().trim(),
                    pod: ($('td:nth-child(4) a', tr).attr('href')||"").trim()||null,
                    date: moment($('td:nth-child(5)', tr).text().trim(), 'DD/MM/YYYY HH:mm:ss').toDate()
                });
            }

            return buildResult(events, {trackingNumber, refAcct, refNum}, trackOptions.history);
        });
    }

    return {
        track: track,
        pattern: /^(\d{5}\/)?0[4-9]\d{15}$/
    }
};
