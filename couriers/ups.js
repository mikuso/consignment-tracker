const PromiseQueue = require('promise-queue');
const Promise = require('bluebird');
const request = Promise.promisify(require('request'));
const moment = require('moment');
const TrackingResultBuilder = require('../tracking-result-builder');
const _ = require('lodash');

const UPS_JSON_API_TEST = "https://wwwcie.ups.com/rest/Track";
const UPS_JSON_API_LIVE = "https://onlinetools.ups.com/rest/Track";

//  M = Manifested
//  I = In Transit
//  D = Delivered
//  X = Exception
const statusMap = {
    "M": "M",
    "I": "I",
    "D": "D",
    "X": "X"
};
function translateStatus(code) {
    let s = statusMap[code];
    if (!s) throw Error(`Unexpected status code: ${code}`);
    return s;
}

function toArray(mixed) {
    if (Array.isArray(mixed)) {
        return mixed;
    }
    return [mixed];
}

/**
 * @param  {object} config
 *   user     : {string}  UPS username
 *   pass     : {string}  UPS password
 *   access   : {string}  UPS Access License Number
 *   testMode : {bool}    Use UPS test servers? (default: false)
 *   concurrency : {number} Number of concurrent lookups allowed (default: 5)
 */
module.exports = function(config) {

    const trackingQueue = new PromiseQueue(config.concurrency || 5, Infinity);

    //   history  : {bool} Fetch full tracking history (default: false)
    async function track(trackingNumber, trackOptions, cache = {}) {
        if (Array.isArray(trackingNumber)) {
            let multicache = {};
            return Promise.all(trackingNumber.map(num => track(num, trackOptions, multicache).catch(error => ({tracking_ref: num, error}))));
        }

        return trackingQueue.add(async () => {
            if (cache[trackingNumber]) {
                return cache[trackingNumber].toJSON({ sort: false, history: trackOptions.history });
            }

            let raw = await trackRaw(trackingNumber, trackOptions.history ? '1' : '0');

            let shipTo = raw.Shipment.ShipmentAddress.find(a => _.get(a, 'Type.Code') == '02');
            let packages = toArray(_.get(raw, 'Shipment.Package', []));

            for (let p of packages) {
                let rb = new TrackingResultBuilder({
                    courier: "ups",
                    service: _.get(raw, 'Shipment.Service.Description', null),
                    tracking_ref: p.TrackingNumber,
                    dispatch_ref: null,
                    consignment_ref: null,
                    parcel_ref: null,
                    po_number: null,
                    dest_postal_code: _.get(shipTo, 'Address.PostalCode', null),
                    dest_country_code: _.get(shipTo, 'Address.CountryCode', null)
                });

                let activities = toArray(_.get(p, 'Activity')).reverse();

                for (let a of activities) {
                    let aloc = _.get(a, 'ActivityLocation');

                    rb.addHistory({
                        status_code: translateStatus(_.get(a, 'Status.Type', 'X')),
                        description: _.get(a, 'Status.Description', 'Unknown'),
                        date: moment(_.get(a, 'Date') + _.get(a, 'Time'), "YYYYMMDDHHmmss").toDate(),
                        location: [
                            _.get(aloc, 'Address.City'),
                            _.get(aloc, 'Address.PostalCode'),
                            _.get(aloc, 'Address.CountryCode'),
                            _.get(aloc, 'Description')
                        ].filter(x=>!!x).join(', '),
                        pod_signatory: _.get(aloc, 'SignedForByName', null)
                    });
                }

                cache[p.TrackingNumber] = rb;
            }

            if (cache[trackingNumber]) {
                return cache[trackingNumber].toJSON({ sort: false, history: trackOptions.history });
            }

            throw Error(`Tracking results not found for ${trackingNumber}`);
        });
    }

    async function trackRaw(trackingNumber, trackOption = '0') {
        if (!config.user || !config.pass || !config.access) {
            throw Error("UPS requires credentials for tracking through API");
        }

        let res = await request({
            method: 'post',
            url: config.testMode ? UPS_JSON_API_TEST : UPS_JSON_API_LIVE,
            json: {
                UPSSecurity: {
                    UsernameToken: {
                        Username: config.user,
                        Password: config.pass
                    },
                    ServiceAccessToken: {
                        AccessLicenseNumber: config.access
                    }
                },
                TrackRequest: {
                    Request: {
                        RequestOption: trackOption
                    },
                    InquiryNumber: trackingNumber
                }
            }
        });

        if (res.statusCode !== 200) {
            throw Error(`Bad status code: ${res.statusCode}`);
        }

        if (res.body.Fault) {
            throw Error(_.get(res, 'body.Fault.faultstring') + ' : ' + _.get(res, 'body.Fault.detail.Errors.ErrorDetail.PrimaryErrorCode.Description'));
        }

        if (_.get(res, 'body.TrackResponse.Response.ResponseStatus.Code') != 1) {
            throw Error(`Bad UPS response status: ${_.get(res, 'body.TrackResponse.Response.ResponseStatus.Description')}`);
        }

        return res.body.TrackResponse;
    }

    return {
        pattern: /^1Z[\dA-Z]{16}$/,
        track
    };
}
