// app/legal/referral-competition-terms/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TennisMate “Refer & Win” – Terms & Conditions",
  description:
    "Full terms and conditions for the TennisMate Refer & Win competition.",
};

const T = {
  PROMOTER_NAME: "TennisMate",
  ABN: "[ABN]",
  ADDRESS: "[registered address]",
  CONTACT_EMAIL: "support@tennis-mate.com.au",
  START_DATE: "[Start Date]",
  END_DATE: "[End Date]",
  DRAW_LOCATION: "[draw location e.g., Melbourne, VIC]",
  PRIVACY_URL: "https://tennismate-s7vk.vercel.app/privacy", // or your path
  TERMS_URL: "https://tennismate-s7vk.vercel.app/legal/referral-competition-terms",
};

export default function ReferralCompetitionTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <article className="prose prose-neutral sm:prose-lg">
        <h1>TennisMate “Refer &amp; Win” – Full Terms &amp; Conditions</h1>

        <p>
          <strong>Promoter:</strong> {T.PROMOTER_NAME} (“Promoter”).<br />
          <strong>Contact:</strong> <a href={`mailto:${T.CONTACT_EMAIL}`}>{T.CONTACT_EMAIL}</a>
        </p>

        <h2>1. Eligibility</h2>
        <ol>
          <li><strong>1.1</strong> Entry is open to residents of Australia aged 18 years or over (“Entrants”).</li>
          <li><strong>1.2</strong> Employees, contractors and immediate family members of the Promoter are ineligible.</li>
          <li><strong>1.3</strong> To participate, Entrants must hold a valid TennisMate account in good standing (not banned/suspended) throughout the Competition Period and at the time of the draw.</li>
        </ol>

        <h2>2. Competition Period</h2>
        <ol>
          <li><strong>2.1</strong> The competition starts <strong>23rd of September, 20205</strong> at 9:00am and ends <strong>23rd of August 2025</strong> at 11:59pm (Australia/Melbourne time) (“Competition Period”).</li>
          <li><strong>2.2</strong> Entries received outside the Competition Period will not be accepted.</li>
        </ol>

        <h2>3. How to Enter</h2>
        <ol>
          <li><strong>3.1</strong> During the Competition Period, share your unique TennisMate referral link with friends.</li>
          <li><strong>3.2</strong> Each <em>Qualified Referral</em> (see clause 4) made during the Competition Period earns the referrer one (1) entry into the random prize draw.</li>
          <li><strong>3.3</strong> There is no entry fee and no purchase necessary. Unlimited entries permitted, however only one (1) entry per unique referred person will be awarded.</li>
        </ol>

        <h2>4. Qualified Referral (definition)</h2>
        <p>A “Qualified Referral” occurs when a new user:</p>
        <ul>
          <li>(a) signs up to TennisMate using the referrer’s link or referral code;</li>
          <li>(b) verifies their email address;</li>
          <li>(c) adds a profile photo; and</li>
          <li>(d) sends at least one (1) match request to a user who is not the referrer.</li>
        </ul>
        <p><strong>Notes:</strong></p>
        <ul>
          <li>The referred person must be a new TennisMate user who has not previously registered.</li>
          <li>Self-referrals, duplicate/fraud accounts, and referrals where the only match request is to the referrer do not qualify.</li>
          <li>The Qualified Referral must be completed within the Competition Period to count.</li>
        </ul>

        <h2>5. Invalid, Fraudulent or Ineligible Entries</h2>
        <ol>
          <li><strong>5.1</strong> The Promoter may, at its sole discretion, verify eligibility and disqualify entries believed to be: automated, generated via fake/duplicate accounts, inconsistent with community guidelines, or otherwise contrary to these Terms.</li>
          <li><strong>5.2</strong> The Promoter may require reasonable evidence to confirm eligibility or completion of referral steps.</li>
        </ol>

        <h2>6. Prize</h2>
        <ol>
          <li><strong>6.1</strong> Prize: AUD $100 Tennis Warehouse Gift Voucher (“Prize”).</li>
          <li><strong>6.2</strong> Total prize pool: AUD $100.</li>
          <li><strong>6.3</strong> Prize is not transferable or exchangeable and no cash alternative will be offered. Voucher is subject to the issuer’s terms and conditions.</li>
        </ol>

        <h2>7. Draw &amp; Winner Selection</h2>
        <ol>
          <li><strong>7.1</strong> This is a game of chance; skill plays no part in determining the winner.</li>
          <li><strong>7.2</strong> A random draw will be conducted by the Promoter at {T.DRAW_LOCATION} within 3 business days after the Competition Period ends, from all valid entries earned during the Competition Period.</li>
          <li><strong>7.3</strong> The odds of winning depend on the total number of valid entries.</li>
        </ol>

        <h2>8. Winner Notification &amp; Claim</h2>
        <ol>
          <li><strong>8.1</strong> The winner will be notified via their TennisMate account email within 7 days of the draw.</li>
          <li><strong>8.2</strong> The winner must claim the Prize within 14 days of notification. If unclaimed, the Promoter may conduct a redraw using the same method.</li>
        </ol>

        <h2>9. Publication</h2>
        <ol>
          <li><strong>9.1</strong> The winner’s first name and initial of surname, and State/Territory, may be published on TennisMate channels.</li>
        </ol>

        <h2>10. Privacy</h2>
        <ol>
          <li><strong>10.1</strong> The Promoter will collect and handle personal information to administer the competition and award the Prize.</li>
          <li><strong>10.2</strong> Personal information will be handled in accordance with TennisMate’s Privacy Policy: <a href={T.PRIVACY_URL}>{T.PRIVACY_URL}</a>.</li>
          <li><strong>10.3</strong> By entering, Entrants consent to this use.</li>
        </ol>

        <h2>11. Liability</h2>
        <ol>
          <li><strong>11.1</strong> Nothing in these Terms excludes any consumer rights under the Australian Consumer Law.</li>
          <li><strong>11.2</strong> To the extent permitted by law, the Promoter is not liable for any loss, damage or injury (including but not limited to indirect or consequential loss) arising in any way from the competition, including but not limited to: technical failures; unauthorised intervention; or the winner’s use of the Prize.</li>
        </ol>

        <h2>12. Platform &amp; Third Parties</h2>
        <ol>
          <li><strong>12.1</strong> The competition is not sponsored, endorsed, administered by, or associated with Tennis Warehouse, Apple or Google.</li>
          <li><strong>12.2</strong> Any third-party names are used solely to describe the Prize. All trademarks are the property of their respective owners.</li>
        </ol>

        <h2>13. Changes &amp; Cancellation</h2>
        <ol>
          <li><strong>13.1</strong> If the competition is interfered with or otherwise not capable of being conducted as reasonably anticipated, the Promoter reserves the right to modify, suspend, terminate or cancel the competition (subject to applicable law).</li>
          <li><strong>13.2</strong> The Promoter may update these Terms where reasonably necessary; the latest version will be posted at the URL in clause 15.</li>
        </ol>

        <h2>14. Governing Law</h2>
        <ol>
          <li><strong>14.1</strong> These Terms are governed by the laws of Victoria, Australia, and Entrants submit to the exclusive jurisdiction of Victorian courts.</li>
        </ol>

        <h2>15. Where to find these Terms</h2>
        <ol>
          <li><strong>15.1</strong> The current Terms &amp; Conditions are available at: <a href={T.TERMS_URL}>{T.TERMS_URL}</a>.</li>
        </ol>
      </article>
    </main>
  );
}
