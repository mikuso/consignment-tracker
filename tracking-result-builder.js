
class TrackingResultBuilder {
    constructor(data) {
        this.data = {
        	courier: null,
        	service: null,

        	tracking_ref: null,
            dispatch_ref: null,
        	consignment_ref: null,
        	parcel_ref: null,
            po_number: null,

        	dest_postal_code: null,
        	dest_country_code: null,

        	history: []
        };

        if (data) {
            this.assign(data);
        }
    }

    assign(data) {
        Object.assign(this.data, data);
    }

    addHistory(data) {
        let defaultData = {
            status_code: "?",
            description: "Unknown",
            location: "Unknown",
            pod_signatory: null,
            pod_image_url: null,
            date: null,
            comments: null
        };

        Object.assign(defaultData, data);
        this.data.history.push(defaultData);
    }

    toJSON(options) {
        options = Object.assign({
            sort: true
        }, options || {});

        const keys = [
            "courier",
            "service",
            "tracking_ref",
            "dispatch_ref",
            "consignment_ref",
            "parcel_ref",
            "po_number",
            "dest_postal_code",
            "dest_country_code"
        ];

        let result = {};
        for (let key of keys) {
            result[key] = this.data[key];
        }

        if (this.data.history.length > 0) {
            let history = this.data.history.map(x => Object.assign({}, x));
            if (options.sort) {
                history.sort((a,b) => {
                    if (!a.date || !b.date) return 0;
                    return a.date > b.date ? 1 : -1;
                });
            }
            let latest = history.pop();
            Object.assign(result, latest);
            if (options.history) {
                result.history = history;
            }
        } else {
            let e = Error("No tracking history");
            e.result = result;
            throw e;
        }

        return result;
    }
}

module.exports = TrackingResultBuilder;
