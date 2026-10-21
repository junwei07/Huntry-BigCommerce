import Image from "next/image";
import { Box, Flex, H1, H4, Link, Panel, Small, Text } from "@bigcommerce/big-design";
import { BaselineHelpIcon } from "@bigcommerce/big-design-icons";

const DEVELOPER_LOGO_FILENAME = process.env.DEVELOPER_LOGO_FILENAME || "developer-logo.svg";
const DEVELOPER_NAME = process.env.DEVELOPER_NAME || "Huntry";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "info@nytt-tech.com";
const SUPPORT_URL = process.env.SUPPORT_URL || "https://huntry.io";

export function HelpPage() {
  return (
    <Box style={{ maxWidth: "480px" }}>
      <H1>Help</H1>
      <Panel>
      <Flex flexDirection="column" alignItems="center" marginBottom="large">
        <Image
          src={`/${DEVELOPER_LOGO_FILENAME}`}
          alt={`${DEVELOPER_NAME} logo`}
          width={40}
          height={40}
        />
        <H4 marginTop="small" marginBottom="none">
          {DEVELOPER_NAME}
        </H4>
      </Flex>

      <Box marginBottom="medium">
        <Flex alignItems="center" marginBottom="xSmall">
          <BaselineHelpIcon color="secondary60" size="small" />
          <Small marginLeft="xSmall" marginBottom="none">
            Support
          </Small>
        </Flex>
        <Flex alignItems="center">
          <Text marginBottom="none" marginRight="xxSmall">
            Email:
          </Text>
          <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link>
        </Flex>
        <Flex alignItems="center">
          <Text marginBottom="none" marginRight="xxSmall">
            Website:
          </Text>
          <Link href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            {SUPPORT_URL}
          </Link>
        </Flex>
      </Box>
      </Panel>
    </Box>
  );
}
