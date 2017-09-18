## Install

`npm i consignment-tracker`

## Example

```js
const config = {
    ups: { // UPS config (required for UPS tracking only)
        user: "xxxx",  // UPS username
        pass: "xxxx",  // UPS password
        access: "xxxx" // UPS Access License Number
    }
};
const track = require('consignment-tracker')(config);

let result = await track('XXXXXXXXXXXXXXXX');

let results = await track([
    '1111111111111',
    '2222222222222',
    '3333333333333'
]);
```

# Usage

Track a single consignment
```js
let result = await track(reference);
```

Track a batch of consignments
```js
let results = await track([ref1, ref2, ref3]);
```

Track a single consignment and request full tracking history.
```js
let result = await track(reference, {history: true});
```

## Notes

- In the case of tracking a single reference, `track()` will throw an error if there is a failure performing the tracking.
- If you provide an array to `track()`, it will not throw.  Instead, each individual error in the batch will be returned in the results along with the corresponding tracking reference.
- If performing many lookups, it is always preferable to track an array of references, rather than individually. The tracking has appropriate built-in rate limiting (independent for each courier), and can sometimes eliminate some requests altogether.
- The result from a batch-track will not be returned in the same order as requested.

## Result schema

### Status codes

- `D` : Delivered
- `I` : In Transit
- `X` : Exception (failure in the delivery process, e.g. address not found)
- `M` : Manifested (parcel not yet handed to the courier)

### Result object

```js
{
	courier: {type:"string"},
	service: {type:"string"},
	tracking_ref: {type:"string"},
	consignment_ref: {type:"string"},
	parcel_ref: {type:"string"},
	po_number: {type:"string"},
	dest_postal_code: {type:"string"},
	dest_country_code: {type:"string"},
	status_code: {type:"string", enum:["D", "I", "X", "M"]},
	description: {type:"string"},
	location: {type:"string"},
	pod_signatory: {type:"string"},
	pod_image_url: {type:"string"},
	date: {type:"date"},
	comments:  {type:"string"},
	history: [
		{
			status_code: {type:"string", enum:["D", "I", "X", "M"]},
			description: {type:"string"},
			location: {type:"string"},
			pod_signatory: {type:"string"},
			pod_image_url: {type:"string"},
			date: {type:"date"},
			comments: {type:"string"}
		}
	]
}
```
