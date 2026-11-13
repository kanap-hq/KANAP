---
title: IT handbook for employees
summary: The everyday IT guide of Fromage & Co: accounts, mail, files, printing, phones, software, security and travel.
status: published
lang: en
---
This handbook gathers the everyday IT rules and tips of Fromage & Co. It is written for office staff in Paris, Gouda and Parma and for the sales offices. Production staff also have a dedicated manual for the workshops.

## 1. Your first day

Your manager requests your accounts through the onboarding portal at least five business days before your start date. On your first day, the service desk hands you a laptop that is already prepared with your name. You sign in with your corporate email and the temporary password given by the service desk, then Okta asks you to choose your own password and to install **Okta Verify** on your phone. From then on, the same password opens Windows, Microsoft 365, SAP and the VPN.

The service desk is open from 8:00 to 18:00 (CET) on business days, on extension 4400 or through the self-service portal. Outside these hours, only production incidents are handled, through the on-call number posted in each workshop.

## 2. Mail and calendar

Mail and calendars run on **Microsoft 365**. Outlook is installed on every laptop; on a phone, use the Outlook app. Your mailbox holds 50 GB. Mail older than three years is moved automatically to the online archive, which you can still search from Outlook.

Your email signature follows the company template: name, job title, site, phone number. The template is available on the Communication SharePoint site; do not add images or slogans of your own.

Shared mailboxes (orders@, quality@, invoices@) are requested by their owner through the self-service portal. Once access is granted, the mailbox appears in Outlook within an hour, without any action on your side.

## 3. Files

Personal files go to **OneDrive** (1 TB per person). Team files go to the team's **SharePoint** site. USB keys are blocked on laptops for writing: to send a large file to a supplier, use a sharing link from OneDrive, valid for 30 days.

Deleted files stay in the OneDrive recycle bin for 93 days. After that, the service desk can no longer restore them.

## 4. Printing

All office printers use secure printing: send the document to the **Fromage-Secure** queue, then release it at any copier with your badge. Label printers in the warehouses and production sites are managed by Production IT.

## 5. Phones

Company phones are enrolled in **Intune** through the Company Portal app. Personal phones may use Outlook and Teams under the app protection policy. Report a lost or stolen phone to the service desk at once so it can be wiped remotely.

## 6. Software

Approved software is installed from the **Software Center** on your laptop, without administrator rights. If an application you need is not in the catalogue, request it through the self-service portal: IT checks the licence, the security of the editor and the data it handles. Paid licences need the approval of your cost center manager. Personal software, browser extensions that read web pages and remote-control tools are not allowed.

Windows and Office updates are installed automatically on Tuesdays. Restart your laptop at least once a week so they apply; after 14 days without a restart, Windows forces it at the end of the day.

## 7. Security

Phishing messages are the most common attack against the company. When a message looks suspicious, use the **Report** button in Outlook rather than deleting it: the security team analyses it and removes copies from other mailboxes. Never approve an Okta push that you did not request yourself; if this happens, report it to the service desk.

Lock your laptop (Windows + L) when you leave your desk. Screens lock automatically after 10 minutes.

## 8. Travelling abroad

Laptops and phones work abroad without any request. Mobile data roaming is enabled in the European Union; for other countries, ask the service desk to enable a travel data plan one week ahead. In countries where the VPN is restricted, Microsoft 365 remains reachable without VPN; SAP is not. Do not use public USB charging stations.

## 9. Laptop asks for a BitLocker recovery key

All laptops are encrypted with **BitLocker**. After a BIOS update, a change of docking station or a hardware repair, the laptop may stop at a blue screen asking for a **48-digit recovery key** before Windows starts. This is expected and does not mean your data is lost.

1. On another device (your phone, for instance), open `myaccount.microsoft.com` and sign in with your corporate account.
2. Go to **Devices**, select your laptop, then **View BitLocker keys**.
3. Compare the key ID shown on the blue screen with the one on the page, then type the 48 digits on the laptop.

If you cannot see your laptop in the list, call the service desk with the key ID displayed on the screen: they read the key to you after checking your identity. Never write the recovery key on the laptop or keep it in the laptop bag.

## 10. Absences and automatic replies

Set your own automatic reply in Outlook (**File > Automatic Replies**) before a holiday. When a colleague is absent unexpectedly (sick leave, for instance) and their mailbox needs an automatic reply or must be read by someone else, their **manager** requests it through the self-service portal under **Mailbox delegation**. The service desk does not set automatic replies or give access to a mailbox at the request of a colleague, for privacy reasons; the delegation ends automatically after 30 days.

## 11. Shared kiosk computers

Kiosk computers in the shops, the tasting room and the warehouse offices run under a shared account (`KIOSK-` followed by the site code). Never sign in on them with your personal account and never save a password in their browser. They restart every night at 3:00 and lose everything stored locally.

## 12. Leaving the company

On your last day, return your laptop, badge and phone to the service desk. Your mailbox is kept for 90 days with an automatic reply naming your successor, then deleted.
