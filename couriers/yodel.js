const PromiseQueue = require('promise-queue');
const Promise = require('bluebird');
const request = Promise.promisify(require('request'));
const moment = require('moment');
const TrackingResultBuilder = require('../tracking-result-builder');
const parseXML = Promise.promisify(require('xml2js').parseString);

const codemap = {
    "1": "M",
    "A": "I",
    "AC": "X",
    "AH": "I",
    "AM": "I",
    "BJ": "I",
    "BH": "I",
    "CA": "I",
    "CC": "I",
    "CY": "I",
    "CZ": "I",
    "E": "X",
    "EC": "I",
    "ED": "I",
    "ET": "I",
    "G": "I",
    "HO": "I",
    "HR": "I",
    "HU": "I",
    "GX": "X",
    "I": "X",
    "SB": "I",
    "SP": "I",
    "T": "X",
    "UG": "X",
    "V": "X",
    "W": "I",
    "ZC": "D",
    "ZN": "D",
    "Z": "D",
};

module.exports = function(config){

    const trackingQueue = new PromiseQueue(config.concurrency || 2, Infinity);

    function translateStatus(code, desc) {
        if (codemap[code]) {
            return codemap[code];
        }

        throw Error("Unrecognised status code: " + code + " : "+ desc);

        if (desc.match(/^delivered\b/i)) {
            return "D";
        }

        return "I";
    }

    function buildResult(events, refs, history) {
        let rb = new TrackingResultBuilder({
            courier: "yodel",
            tracking_ref: refs.trackingNumber
        });

        for (let event of events) {
            let hist = {
                status_code: translateStatus(event.status_code[0], event.status_description[0]),
                description: event.status_description[0],
                location: event.location[0] || "Unknown",
                pod_signatory: event.signatory[0] || null,
                date: moment(event.scan_date +' '+ event.scan_time, "DD-MMM-YYYY HH:mm:ss").toDate()
            };
            rb.addHistory(hist);
        }

        return rb.toJSON({ history: history });
    }

    async function track(trackingNumber, trackOptions) {
        if (Array.isArray(trackingNumber)) {
            return Promise.all(trackingNumber.map(num => track(num, trackOptions).catch(error => ({tracking_ref: num, error}))));
        }

        return trackingQueue.add(async () => {
            let res = await request({
                url: 'http://tracking.yodel.co.uk/wrd/run/wt_xml_gen_pw.getParcelHistory',
                qs: {pcl_no: trackingNumber}
            });

            if (res.statusCode !== 200) {
                throw new Exception(`HTTP error: ${res.statusCode}`);
            }

            let xml = await parseXML(res.body);

            let xmlr = xml.parcel_tracking.response[0];
            if (xmlr.query_status[0] != 0) {
                throw Error(`XML response error: ${xmlr.response_description}`);
            }

            return buildResult(xml.parcel_tracking.parcel_status, {trackingNumber}, trackOptions.history);
        });
    }

    return {
        track: track,
        pattern: /^JD\d{16}$/
    }
};
