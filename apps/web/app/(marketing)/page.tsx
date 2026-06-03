import Link from 'next/link';

import { ArrowRightIcon, LineChart } from 'lucide-react';

import {
  CtaButton,
  FeatureCard,
  FeatureGrid,
  FeatureShowcase,
  FeatureShowcaseIconContainer,
  Hero,
  Pill,
} from '@kit/ui/marketing';

import { withI18n } from '~/lib/i18n/with-i18n';

function Home() {
  return (
    <div className={'mt-4 flex flex-col space-y-24 py-14'}>
      <div className={'container mx-auto'}>
        <Hero
          pill={
            <Pill label={'EVA IQ Signals'}>
              <span>First-party signal, not a thin ad launcher</span>
            </Pill>
          }
          title={
            <>
              <span>Meta ads that run</span>
              <span>like the Foundry</span>
            </>
          }
          subtitle={
            <span>
              EVA IQ analyzes your ad performance, writes the copy and creative,
              and tells you exactly what to do next — powered by a first-party
              signal engine that turns real buyers into your best-performing
              audiences.
            </span>
          }
          cta={<MainCallToActionButton />}
        />
      </div>

      <div className={'container mx-auto'}>
        <div className={'flex flex-col space-y-16 xl:space-y-32 2xl:space-y-36'}>
          <FeatureShowcase
            heading={
              <>
                <b className="font-semibold dark:text-white">
                  Owned data. Vertical depth. Outcomes you can see.
                </b>
                .{' '}
                <span className="text-muted-foreground font-normal">
                  The parts a generic ad tool can&apos;t copy — built in from day
                  one.
                </span>
              </>
            }
            icon={
              <FeatureShowcaseIconContainer>
                <LineChart className="h-5" />
                <span>One platform, end to end</span>
              </FeatureShowcaseIconContainer>
            }
          >
            <FeatureGrid>
              <FeatureCard
                className={'relative col-span-2 overflow-hidden'}
                label={'Meta Advisor'}
                description={`Upload your ad export and get an instant, benchmark-graded analysis with a time-aware, step-by-step plan for every ad.`}
              />

              <FeatureCard
                className={'relative col-span-2 w-full overflow-hidden lg:col-span-1'}
                label={'First-party signal engine'}
                description={`Turn real buyers into seed audiences and 1% lookalikes — the mechanism behind 7x–67x ROAS.`}
              />

              <FeatureCard
                className={'relative col-span-2 overflow-hidden lg:col-span-1'}
                label={'Compliance built in'}
                description={`Special Ad Category rules enforced automatically for housing, employment, credit, and finance.`}
              />

              <FeatureCard
                className={'relative col-span-2 overflow-hidden'}
                label={'Outcome ownership'}
                description={`Performance tied to revenue, not vanity metrics — your integrated P&L view across the campus.`}
              />
            </FeatureGrid>
          </FeatureShowcase>
        </div>
      </div>
    </div>
  );
}

export default withI18n(Home);

function MainCallToActionButton() {
  return (
    <div className={'flex space-x-4'}>
      <CtaButton>
        <Link href={'/auth/sign-in'}>
          <span className={'flex items-center space-x-0.5'}>
            <span>Sign in</span>
            <ArrowRightIcon
              className={
                'animate-in fade-in slide-in-from-left-8 h-4' +
                ' zoom-in fill-mode-both delay-1000 duration-1000'
              }
            />
          </span>
        </Link>
      </CtaButton>
    </div>
  );
}
