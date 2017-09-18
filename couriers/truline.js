const PromiseQueue = require('promise-queue');
const Promise = require('bluebird');
const request = Promise.promisify(require('request'));
const cheerio = require('cheerio');
const moment = require('moment');
const TrackingResultBuilder = require('../tracking-result-builder');

module.exports = function(config){

    const trackingQueue = new PromiseQueue(config.concurrency || 2, Infinity);

    function buildResult(events, refs, history) {
        let rb = new TrackingResultBuilder({
            courier: "truline",
            tracking_ref: refs.trackingNumber,
            consignment_ref: refs.despatchNumber,
            po_number: refs.purchaseOrderNumber
        });

        for (let event of events) {
            let hist = {
                description: event.description || "Unknown",
                date: event.date,
                pod_image_url: event.pod
            };

            switch (event.description.toLowerCase()) {
                case 'delivered':
                    hist.status_code = 'D';
                    break;
                case 'failed delivery':
                    hist.status_code = 'X';
                    break;
                default:
                    hist.status_code = 'I';
                    break;
            }

            rb.addHistory(hist);
        }

        return rb.toJSON({history: history});
    }

    async function track(trackingNumber, trackOptions) {
        return trackingQueue.add(async () => {
            if (Array.isArray(trackingNumber)) {
                return Promise.all(trackingNumber.map(num => track(num, trackOptions.history).catch(error => ({ref: num, error}))));
            }

            let despatchNumber = trackingNumber.substr(0, trackingNumber.length-7);
            let purchaseOrderNumber = 'Z' + trackingNumber.substr(trackingNumber.length-7);

            let res = await request({
                url: 'http://epod.truline.co.uk/Delivery/Tracking',
                qs: {despatchNumber, purchaseOrderNumber}
            });

            if (res.statusCode !== 200) {
                throw new Exception(`HTTP error ${res.statusCode}`);
            }

            let events = [];
            let $ = cheerio.load(res.body);
            for (let tr of $('.tracking-results tbody tr').toArray()) {
                events.push({
                    description: $('td:nth-child(1)', tr).text().trim(),
                    boxes: $('td:nth-child(2)', tr).text().trim() * 1,
                    pod: ($('td:nth-child(3) a', tr).attr('href')||"").trim().replace(/manifestPage\.aspx/, 'imgRetrieval.ashx') || null,
                    date: moment($('td:nth-child(4)', tr).text().trim(), 'DD/MM/YYYY HH:mm:ss').toDate()
                });
            }

            return buildResult(events, {despatchNumber, purchaseOrderNumber, trackingNumber}, trackOptions.history);
        });
    }

    return {
        track: track,
        pattern: /^04\d{15}$/
    }
};
