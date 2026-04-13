# Riptag Hivemind

## Deploy to Railway
1. Push this folder to a GitHub repo
2. New project on Railway → Deploy from GitHub → select repo
3. Railway gives you a URL like `https://riptag-hivemind-production.up.railway.app`

## Configure the Extension
In `extension/depopautomation/popup.js`, top 3 lines — set for each Chrome profile:

```js
const HIVEMIND_URL = 'https://your-railway-url.railway.app'; // your real URL
const PC_ID        = 'pc1';   // pc1 through pc6
const GROUP_INDEX  = '0';     // 0, 1, or 2
```

### PC / Group setup:
| PC   | Accounts | Groups | Group 0 | Group 1 | Group 2 |
|------|----------|--------|---------|---------|---------|
| pc1  | 9        | 3      | accts 1-3 | accts 4-6 | accts 7-9 |
| pc2  | 9        | 3      | accts 1-3 | accts 4-6 | accts 7-9 |
| pc3  | 6        | 2      | accts 1-3 | accts 4-6 | —       |
| pc4  | 6        | 2      | accts 1-3 | accts 4-6 | —       |
| pc5  | 9        | 3      | accts 1-3 | accts 4-6 | accts 7-9 |
| pc6  | 9        | 3      | accts 1-3 | accts 4-6 | accts 7-9 |

## Load Extension on Each Chrome Profile
1. Go to `chrome://extensions`
2. Enable Developer Mode
3. Load Unpacked → select the `extension/depopautomation` folder
4. Make sure the 3 config values at the top of `popup.js` match that profile's PC + group

## Daily Workflow
1. Open dashboard at your Railway URL
2. Paste today's store URLs → **Save Queue**
3. Hit **▶ Start All** — all connected extensions fire automatically
4. Watch the PC grid update live as accounts check in
